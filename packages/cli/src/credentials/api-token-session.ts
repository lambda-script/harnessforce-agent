import type { Fetch } from "@harnessforce/agent-core/types";
import { REQUEST_TIMEOUT_MS, readJsonObjectBody } from "../shared/http.js";
import { discoverTokenEndpoint } from "../shared/metadata.js";
import {
	parseStoredApiToken,
	parseTokenPair,
	type StoredApiToken,
	serializeApiToken,
} from "./api-token.js";
import { apiTokenAccount, type Keychain } from "./keychain.js";
import { acquireTokenLock, tokenLockPath } from "./token-lock.js";

export { tokenLockPath } from "./token-lock.js";

// apps/webがあらかじめ登録した固定のpublic client。
const CLIENT_ID = "harnessforce-cli";
// correlation.md「ApiTokenの失効」: lockの中のkeychainの各操作の上限。lockを取る前の読み出しで解錠の確認は済んでいる。
const LOCKED_KEYCHAIN_TIMEOUT_MS = 10_000;

export type ApiTokenSessionDeps = {
	keychain: Keychain;
	workspaceId: string;
	// Read APIのbase URL。harnessforce loginが使った接続先のoriginと一致することを呼び出し側が確かめておく。
	readBase: URL;
	fetch: Fetch;
	now: () => number;
	sleep: (ms: number) => Promise<void>;
	homeDir: string;
};

// `missing`はkeychainにApiTokenが無い、`expired`はrefreshできない（correlation.md「ApiTokenの失効」）。
export type WithTokenOutcome<T> =
	| { kind: "ok"; value: T }
	| { kind: "missing" }
	| { kind: "expired" };

// correlation.md「harnessforce logout」の手順3: `expired`をApiTokenが既に使えないと分かった場合に限り、
// 通信の失敗、lockを取れない、keychainへの保存の失敗を`failed`として分ける。
export type WithTokenOrFailureOutcome<T> =
	| WithTokenOutcome<T>
	| { kind: "failed" };

// refreshの結果。`unusable`はApiTokenが既に使えないと分かった場合、`failed`はそれ以外の失敗。
type Refreshed =
	| { kind: "refreshed"; token: StoredApiToken }
	| { kind: "unusable" }
	| { kind: "failed" };
const UNUSABLE = { kind: "unusable" } as const;
const FAILED = { kind: "failed" } as const;

type RefreshOutcome =
	| { kind: "refreshed"; token: StoredApiToken }
	| { kind: "invalid_grant" }
	| { kind: "failed" };

const isPast = (instant: string, now: number) => now >= Date.parse(instant);

// token endpointへrefresh tokenを送る。redirectは追わない（refresh tokenを別の宛先へ送らない）。
async function requestRefresh(
	endpoint: URL,
	refreshToken: string,
	workspaceId: string,
	fetchImpl: Fetch,
): Promise<RefreshOutcome> {
	try {
		const response = await fetchImpl(endpoint, {
			method: "POST",
			headers: {
				accept: "application/json",
				"content-type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: refreshToken,
				client_id: CLIENT_ID,
			}).toString(),
			redirect: "manual",
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		const body = await readJsonObjectBody(response);
		if (response.status === 400 && body?.error === "invalid_grant")
			return { kind: "invalid_grant" };
		const token =
			response.status === 200 ? parseTokenPair(body, workspaceId) : undefined;
		return token ? { kind: "refreshed", token } : { kind: "failed" };
	} catch {
		return { kind: "failed" };
	}
}

// keychainの`<workspace_id>:api-token`。読めない値と形の違う値は、ApiTokenが無いものとして扱う。
function tokenStore(deps: ApiTokenSessionDeps, keychain: Keychain) {
	const account = apiTokenAccount(deps.workspaceId);
	return {
		read: async () =>
			parseStoredApiToken(
				await keychain.get(account).catch(() => undefined),
				deps.workspaceId,
			),
		save: (token: StoredApiToken) =>
			keychain
				.set(account, serializeApiToken(token))
				.then(() => true)
				.catch(() => false),
	};
}
type TokenStore = ReturnType<typeof tokenStore>;

// token endpointでrefresh tokenを交換し、保存できた新しい組を返す。
async function exchange(
	stored: StoredApiToken,
	deps: ApiTokenSessionDeps,
	store: TokenStore,
): Promise<Refreshed> {
	if (isPast(stored.refreshTokenExpiresAt, deps.now())) return UNUSABLE;
	const endpoint = await discoverTokenEndpoint(deps.readBase, deps.fetch);
	if (!endpoint) return FAILED;
	const outcome = await requestRefresh(
		endpoint,
		stored.refreshToken,
		deps.workspaceId,
		deps.fetch,
	);
	if (outcome.kind === "refreshed")
		return (await store.save(outcome.token)) ? outcome : FAILED;
	if (outcome.kind === "failed") return FAILED;
	// 別のprocessが先に交換して保存したtokenがあれば、それで続ける。
	const reread = await store.read();
	return reread && reread.refreshToken !== stored.refreshToken
		? { kind: "refreshed", token: reread }
		: UNUSABLE;
}

// lockの中でkeychainを読み直し、別のprocessがrefresh済みならそのtokenを使う。
async function refreshUnderLock(
	used: StoredApiToken,
	deps: ApiTokenSessionDeps,
): Promise<Refreshed> {
	const store = tokenStore(
		deps,
		deps.keychain.withTimeout(LOCKED_KEYCHAIN_TIMEOUT_MS),
	);
	const release = await acquireTokenLock(tokenLockPath(deps.homeDir), {
		now: deps.now,
		sleep: deps.sleep,
	}).catch(() => undefined);
	if (!release) return FAILED;
	try {
		// lockの中の読み出しは上限時間で失敗しうるため、読めないことをApiTokenが無いことと区別できない。
		const stored = await store.read();
		if (!stored) return FAILED;
		const isRefreshedElsewhere =
			stored.accessToken !== used.accessToken &&
			!isPast(stored.accessTokenExpiresAt, deps.now());
		return isRefreshedElsewhere
			? { kind: "refreshed", token: stored }
			: await exchange(stored, deps, store);
	} finally {
		await release();
	}
}

// Read APIの呼び出しを、期限切れと401でrefreshして続ける（correlation.md「ApiTokenの失効」）。
// refreshしたtokenは、同じprocessの後の呼び出しでも使う。
export function createApiTokenSession(deps: ApiTokenSessionDeps) {
	const store = tokenStore(deps, deps.keychain);
	const refresh = (used: StoredApiToken) => refreshUnderLock(used, deps);
	let current: StoredApiToken | undefined;

	const failureOf = (refreshed: Refreshed) =>
		refreshed.kind === "unusable"
			? ({ kind: "expired" } as const)
			: ({ kind: "failed" } as const);

	async function withTokenOrFailure<T>(
		request: (accessToken: string) => Promise<T>,
		isUnauthorized: (result: T) => boolean,
	): Promise<WithTokenOrFailureOutcome<T>> {
		let token = current ?? (await store.read());
		if (!token) return { kind: "missing" };
		let isJustRefreshed = false;
		if (isPast(token.accessTokenExpiresAt, deps.now())) {
			const refreshed = await refresh(token);
			if (refreshed.kind !== "refreshed") return failureOf(refreshed);
			token = refreshed.token;
			isJustRefreshed = true;
		}
		current = token;
		const first = await request(token.accessToken);
		if (!isUnauthorized(first)) return { kind: "ok", value: first };
		// refresh直後のaccess tokenで401を受けたら、再びrefreshしない。
		if (isJustRefreshed) return { kind: "expired" };
		const refreshed = await refresh(token);
		if (refreshed.kind !== "refreshed") return failureOf(refreshed);
		current = refreshed.token;
		const retried = await request(refreshed.token.accessToken);
		return isUnauthorized(retried)
			? { kind: "expired" }
			: { kind: "ok", value: retried };
	}

	// 失敗の理由を分けない呼び出し。refreshできなければ、理由によらず`expired`とする。
	async function withToken<T>(
		request: (accessToken: string) => Promise<T>,
		isUnauthorized: (result: T) => boolean,
	): Promise<WithTokenOutcome<T>> {
		const outcome = await withTokenOrFailure(request, isUnauthorized);
		return outcome.kind === "failed" ? { kind: "expired" } : outcome;
	}

	// Read APIへのfetch。Authorizationは呼び出し側の値を使わず、sessionのaccess tokenで置き換える。
	// refreshできなければ401の応答を返し、呼び出し側はそれを「ログインの有効期限が切れました」の終端にする。
	function authorizedFetch(fetchImpl: Fetch): Fetch {
		return async (url, init) => {
			const outcome = await withToken(
				(accessToken) => {
					const headers = new Headers(init.headers);
					headers.set("authorization", `Bearer ${accessToken}`);
					return fetchImpl(url, { ...init, headers });
				},
				(response) => response.status === 401,
			);
			return outcome.kind === "ok"
				? outcome.value
				: new Response(null, { status: 401 });
		};
	}

	return { withToken, withTokenOrFailure, authorizedFetch };
}
