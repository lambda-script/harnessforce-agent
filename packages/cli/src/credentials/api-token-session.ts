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

export type ApiTokenSessionDeps = {
	keychain: Keychain;
	workspaceId: string;
	// Read APIのbase URL。harnessforce initが使った接続先のoriginと一致することを呼び出し側が確かめておく。
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
function tokenStore(deps: ApiTokenSessionDeps) {
	const account = apiTokenAccount(deps.workspaceId);
	return {
		read: async () =>
			parseStoredApiToken(
				await deps.keychain.get(account).catch(() => undefined),
				deps.workspaceId,
			),
		save: (token: StoredApiToken) =>
			deps.keychain
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
): Promise<StoredApiToken | undefined> {
	if (isPast(stored.refreshTokenExpiresAt, deps.now())) return undefined;
	const endpoint = await discoverTokenEndpoint(deps.readBase, deps.fetch);
	if (!endpoint) return undefined;
	const outcome = await requestRefresh(
		endpoint,
		stored.refreshToken,
		deps.workspaceId,
		deps.fetch,
	);
	if (outcome.kind === "refreshed")
		return (await store.save(outcome.token)) ? outcome.token : undefined;
	if (outcome.kind === "failed") return undefined;
	// 別のprocessが先に交換して保存したtokenがあれば、それで続ける。
	const reread = await store.read();
	return reread && reread.refreshToken !== stored.refreshToken
		? reread
		: undefined;
}

// lockの中でkeychainを読み直し、別のprocessがrefresh済みならそのtokenを使う。
async function refreshUnderLock(
	used: StoredApiToken,
	deps: ApiTokenSessionDeps,
	store: TokenStore,
): Promise<StoredApiToken | undefined> {
	const release = await acquireTokenLock(tokenLockPath(deps.homeDir), {
		now: deps.now,
		sleep: deps.sleep,
	}).catch(() => undefined);
	if (!release) return undefined;
	try {
		const stored = await store.read();
		if (!stored) return undefined;
		const isRefreshedElsewhere =
			stored.accessToken !== used.accessToken &&
			!isPast(stored.accessTokenExpiresAt, deps.now());
		return isRefreshedElsewhere ? stored : await exchange(stored, deps, store);
	} finally {
		await release();
	}
}

// Read APIの呼び出しを、期限切れと401でrefreshして続ける（correlation.md「ApiTokenの失効」）。
// refreshしたtokenは、同じprocessの後の呼び出しでも使う。
export function createApiTokenSession(deps: ApiTokenSessionDeps) {
	const store = tokenStore(deps);
	const refresh = (used: StoredApiToken) => refreshUnderLock(used, deps, store);
	let current: StoredApiToken | undefined;

	async function withToken<T>(
		request: (accessToken: string) => Promise<T>,
		isUnauthorized: (result: T) => boolean,
	): Promise<WithTokenOutcome<T>> {
		let token = current ?? (await store.read());
		if (!token) return { kind: "missing" };
		let isJustRefreshed = false;
		if (isPast(token.accessTokenExpiresAt, deps.now())) {
			token = await refresh(token);
			if (!token) return { kind: "expired" };
			isJustRefreshed = true;
		}
		current = token;
		const first = await request(token.accessToken);
		if (!isUnauthorized(first)) return { kind: "ok", value: first };
		// refresh直後のaccess tokenで401を受けたら、再びrefreshしない。
		if (isJustRefreshed) return { kind: "expired" };
		const refreshed = await refresh(token);
		if (!refreshed) return { kind: "expired" };
		current = refreshed;
		const retried = await request(refreshed.accessToken);
		return isUnauthorized(retried)
			? { kind: "expired" }
			: { kind: "ok", value: retried };
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

	return { withToken, authorizedFetch };
}
