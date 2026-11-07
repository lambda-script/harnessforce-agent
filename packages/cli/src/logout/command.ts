import { access } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import type { Env, Fetch } from "@harnessforce/agent-core/types";
import { parseAllowedUrl } from "@harnessforce/agent-core/url";
import { parseStoredApiToken } from "../credentials/api-token.js";
import { createApiTokenSession } from "../credentials/api-token-session.js";
import {
	apiTokenAccount,
	ingestKeyAccount,
	type Keychain,
	type KeychainItem,
	type LogoutKeychain,
	urlOriginAccount,
	workspaceIdOf,
} from "../credentials/keychain.js";
import { readSettingsEnv } from "../destinations.js";
import {
	codexConfigPath,
	isCodexConfigReadable,
	readExistingCodexConfig,
	withoutHarnessforce,
	writeCodexConfig,
} from "../shared/codex-config.js";
import { REQUEST_TIMEOUT_MS } from "../shared/http.js";
import { sha256Hex } from "../shared/login-settings.js";
import {
	keychainUnavailableMessage,
	LOGIN_MESSAGES,
	LOGOUT_MESSAGES,
	unrevokedKeyMessage,
} from "../shared/messages.js";
import {
	hasLoginSettings,
	hasWritableMarketplaces,
	readUserSettings,
	userSettingsPath,
	withoutLoginSettings,
	writeUserSettings,
} from "../shared/settings.js";
import { runUntilStop, stopWith } from "../shared/stop.js";

export type LogoutDeps = {
	env: Env;
	keychain: Keychain;
	homeDir: string;
	stdout: (text: string) => void;
	stderr: (text: string) => void;
	fetch: Fetch;
	now: () => number;
	sleep: (ms: number) => Promise<void>;
};

// `revoked`は204を受けた、`unusable`はApiTokenが既に使えないと分かった、`failed`はそれ以外。
type Revocation = "revoked" | "unusable" | "failed";

// correlation.md「harnessforce logout」。失効させてから端末の項目を消す。
// 失効させる前に端末から消すと、有効なkeyを端末から辿れなくなるためである。
export function logoutCommand(deps: LogoutDeps): Promise<number> {
	return runUntilStop(() => runLogout(deps), deps.stderr);
}

async function runLogout(deps: LogoutDeps): Promise<number> {
	const { keychain } = deps;
	// 手順1: 失効させた後に設定を消せず、keyの無い設定が残ることを避けるため、何も変える前に確かめる。
	if (!(await keychain.isAvailable().catch(() => false)))
		stopWith(keychainUnavailableMessage(keychain));
	const settingsPath = userSettingsPath(deps.env, deps.homeDir);
	const settings = await readUserSettings(settingsPath);
	if (
		settings.kind === "invalid" ||
		!hasWritableMarketplaces(settings.settings)
	)
		return stopWith(LOGIN_MESSAGES.settingsUnreadable);
	const codexPath = codexConfigPath(deps.env, deps.homeDir);
	const codexText = await readExistingCodexConfig(codexPath).catch(() =>
		stopWith(LOGOUT_MESSAGES.codexUnreadable),
	);
	if (codexText !== undefined && !isCodexConfigReadable(codexText))
		stopWith(LOGOUT_MESSAGES.codexUnreadable);

	// 手順2: 列挙できないkernelのkeyringからは、前回のloginのWorkspaceの項目だけを読む。
	const { HARNESSFORCE_WORKSPACE_ID: workspaceId } =
		await readSettingsEnv(settingsPath);
	const store =
		(await keychain
			.openForLogout(workspaceId)
			.catch(() => stopWith(LOGIN_MESSAGES.keychainUnavailable))) ??
		stopWith(keychainUnavailableMessage(keychain));
	const workspaces = byWorkspace(store.items);
	if (
		workspaces.size === 0 &&
		!hasLoginSettings(settings.settings) &&
		!hasCodexSettings(codexText)
	) {
		deps.stdout(`${LOGOUT_MESSAGES.nothing}\n`);
		return 0;
	}

	// 手順3と4。
	const done: string[] = [];
	const unrevoked: string[] = [];
	for (const [id, items] of workspaces) {
		const revocation = await revoke(id, items, deps);
		if (revocation === "failed") {
			await removeFromKeychain(store, done);
			return stopWith(LOGOUT_MESSAGES.network);
		}
		done.push(id);
		// 前回のlogoutが失効を済ませた後に止まった端末も、ここに当たる。
		if (revocation === "unusable" && items.has(ingestKeyAccount(id)))
			unrevoked.push(id);
	}
	await removeFromKeychain(store, done);

	// 手順5: 再実行は、残った設定の項目を手順2で見つけてここを行う。
	await removeSettings(settingsPath, codexPath).catch(() =>
		stopWith(LOGOUT_MESSAGES.settingsRemoveFailed),
	);

	// 手順6。managed settingsと`~/.harnessforce/`の他のfileには触れない。
	const lines = [
		...unrevoked.map(unrevokedKeyMessage),
		LOGOUT_MESSAGES.success,
	];
	deps.stdout(`${lines.join("\n")}\n`);
	return 0;
}

// Workspaceごとの、accountから値への対応。
function byWorkspace(
	items: readonly KeychainItem[],
): Map<string, Map<string, string>> {
	const workspaces = new Map<string, Map<string, string>>();
	for (const { account, secret } of items) {
		const id = workspaceIdOf(account);
		if (id === undefined) continue;
		const accounts = workspaces.get(id) ?? new Map<string, string>();
		accounts.set(account, secret);
		workspaces.set(id, accounts);
	}
	return workspaces;
}

// 書き換えられないfileは、手順5で消せない項目を持つものとして扱い、失敗の文言で知らせる。
function hasCodexSettings(text: string | undefined): boolean {
	if (text === undefined) return false;
	try {
		return withoutHarnessforce(text) !== text;
	} catch {
		return true;
	}
}

// 手順3: 保存した`<workspace_id>:url-origin`へ送る。複数のWorkspaceの項目を持つ端末で、
// それぞれのtokenを発行した接続先へ送り、repositoryの`env`が書き換えた接続先へtokenを送らないためである。
async function revoke(
	workspaceId: string,
	items: ReadonlyMap<string, string>,
	deps: LogoutDeps,
): Promise<Revocation> {
	const token = parseStoredApiToken(
		items.get(apiTokenAccount(workspaceId)),
		workspaceId,
	);
	const urlOrigin = items.get(urlOriginAccount(workspaceId));
	const base = urlOrigin === undefined ? undefined : parseAllowedUrl(urlOrigin);
	if (!token || !base) return "unusable";
	const key = items.get(ingestKeyAccount(workspaceId));
	const keyHashes = key === undefined ? [] : [sha256Hex(key)];
	const session = createApiTokenSession({
		keychain: deps.keychain,
		workspaceId,
		readBase: base,
		fetch: deps.fetch,
		now: deps.now,
		sleep: deps.sleep,
		homeDir: deps.homeDir,
	});
	const outcome = await session.withTokenOrFailure(
		(accessToken) => requestRevoke(base, accessToken, keyHashes, deps.fetch),
		(status) => status === 401,
	);
	switch (outcome.kind) {
		case "ok":
			return outcome.value === 204 ? "revoked" : "failed";
		// 手順2で読めたtokenを読み直しで失った場合は「api-tokenが無い」に当たらない。失効させずに消さないよう失敗とする。
		case "missing":
			return "failed";
		case "expired":
			return "unusable";
		case "failed":
			return "failed";
	}
}

// read-api.md `POST /api/v1/cli/credentials/revoke`のstatus。接続の失敗と上限時間の超過はundefined。
// redirectは追わない（tokenを別の宛先へ送らない）。
async function requestRevoke(
	base: URL,
	accessToken: string,
	keyHashes: readonly string[],
	fetchImpl: Fetch,
): Promise<number | undefined> {
	try {
		const response = await fetchImpl(
			new URL("/api/v1/cli/credentials/revoke", base.origin),
			{
				method: "POST",
				headers: {
					accept: "application/json",
					authorization: `Bearer ${accessToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ revoke_key_hashes: keyHashes }),
				redirect: "manual",
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			},
		);
		await response.body?.cancel();
		return response.status;
	} catch {
		return undefined;
	}
}

// 手順4: 失効は済んでおり、再実行は失効できないWorkspaceとして扱う。
async function removeFromKeychain(
	store: LogoutKeychain,
	workspaceIds: readonly string[],
): Promise<void> {
	try {
		for (const id of workspaceIds) await store.deleteWorkspace(id);
	} catch {
		stopWith(LOGOUT_MESSAGES.keychainRemoveFailed);
	}
}

const exists = (path: string) =>
	access(path).then(
		() => true,
		() => false,
	);

// 手順5: どちらのfileも他の項目は変えず、無ければ何もしない。
async function removeSettings(
	settingsPath: string,
	codexPath: string,
): Promise<void> {
	if (await exists(settingsPath)) {
		const current = await readUserSettings(settingsPath);
		if (current.kind === "invalid") throw new Error("user settings");
		const next = withoutLoginSettings(current.settings);
		if (!isDeepStrictEqual(next, current.settings))
			await writeUserSettings(settingsPath, next);
	}
	const text = await readExistingCodexConfig(codexPath);
	if (text === undefined) return;
	const next = withoutHarnessforce(text);
	if (next !== text) await writeCodexConfig(codexPath, next);
}
