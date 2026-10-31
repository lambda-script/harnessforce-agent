import { createHash } from "node:crypto";
import type { Env, Fetch } from "@harnessforce/agent-core/types";
import { parseAllowedUrl, withoutExtras } from "@harnessforce/agent-core/url";
import {
	parseStoredApiToken,
	serializeApiToken,
} from "../credentials/api-token.js";
import {
	apiTokenAccount,
	apiTokenWorkspaceId,
	type InitKeychain,
	ingestKeyAccount,
	ingestOriginAccount,
	isIngestKeyAccount,
	type Keychain,
	urlOriginAccount,
} from "../credentials/keychain.js";
import { readSettingsEnv } from "../destinations.js";
import {
	codexConfigPath,
	mergeCodexConfig,
	readCodexConfig,
	writeCodexConfig,
} from "../shared/codex-config.js";
import {
	codexNotes,
	contentEnabledMessage,
	INIT_MESSAGES,
	type InitMessage,
	keychainUnavailableMessage,
	kwalletUnlockHint,
	listenFailedMessage,
	nonDefaultConnectionMessage,
} from "../shared/messages.js";
import { discoverAuthorizationEndpoint } from "../shared/metadata.js";
import {
	hasWritableMarketplaces,
	mergeUserSettings,
	readUserSettings,
	userSettingsPath,
	withPluginAutoUpdate,
	writeUserSettings,
} from "../shared/settings.js";
import { isStop, runUntilStop, stopWith } from "../shared/stop.js";
import {
	type ContentSettings,
	type CredentialOutcome,
	type Issued,
	requestCredentials,
} from "./credentials-api.js";
import type {
	Callback,
	CompletionStatus,
	Loopback,
	startLoopback,
} from "./loopback.js";
import { createLoginSecrets, type LoginSecrets } from "./pkce.js";

export type InitDeps = {
	env: Env;
	keychain: Keychain;
	stdout: (text: string) => void;
	stderr: (text: string) => void;
	fetch: Fetch;
	openBrowser: (url: string) => Promise<boolean>;
	startLoopback: typeof startLoopback;
	homeDir: string;
	// buildの入力で与えた既定の接続先（correlation.md「接続先」）。
	defaultUrl: string;
	callbackTimeoutMs: number;
};

// `harnessforce init`の引数。portが無ければloopbackのcallback portの既定を使う。
export type InitArgs = {
	url: string | undefined;
	port: number | undefined;
	sendContent: boolean;
	// `--no-plugin-auto-update`。Claude Codeのpluginの自動更新を止める。
	noPluginAutoUpdate: boolean;
};

// apps/webがあらかじめ登録した固定のpublic client。
const CLIENT_ID = "harnessforce-cli";
// loopbackのcallback portの既定。一般的なHTTPのport（correlation.md「CLI」）。
const DEFAULT_PORT = 8080;
// POST /api/v1/cli/credentialsが受け付けるrevoke_key_hashesとrevoke_api_token_hashesの上限。
const MAX_REVOKE_HASHES = 100;

const stop = (message: InitMessage): never => stopWith(INIT_MESSAGES[message]);

const sha256Hex = (value: string) =>
	createHash("sha256").update(value, "utf8").digest("hex");

export function init(args: InitArgs, deps: InitDeps): Promise<number> {
	return runUntilStop(async () => {
		const { codexPath, connection, isKernelKeyring, isPluginAutoUpdateOn } =
			await runInit(args, deps);
		// 既定の本番以外へ向けた端末で、利用者が接続先に気づけるようにする。既定のときは何も足さない。
		if (connection !== withoutExtras(new URL(deps.defaultUrl)))
			deps.stdout(`${nonDefaultConnectionMessage(connection)}\n`);
		// 保存先がdiskに残らないことを知らないと、再起動の後にテレメトリが届かない理由を見つけられない。
		const lines = [
			INIT_MESSAGES.success,
			...(isKernelKeyring ? [INIT_MESSAGES.savedToKernelKeyring] : []),
			...(isPluginAutoUpdateOn ? [INIT_MESSAGES.pluginAutoUpdateOn] : []),
			codexNotes(codexPath),
		];
		deps.stdout(`${lines.join("\n")}\n`);
		return 0;
	}, deps.stderr);
}

// 書いたCodexの`config.toml`のpath、記録した接続先、keyをkernelのkeyringへ保存したかを返す。
async function runInit(
	args: InitArgs,
	deps: InitDeps,
): Promise<{
	codexPath: string;
	connection: string;
	isKernelKeyring: boolean;
	isPluginAutoUpdateOn: boolean;
}> {
	const port = args.port ?? DEFAULT_PORT;
	const base =
		parseAllowedUrl(args.url ?? deps.defaultUrl) ?? stop("invalidUrl");
	// settingsへは送信先と同じくscheme、host、port、pathだけを書き、userinfoを残さない。
	const recordedUrl = withoutExtras(base);
	const settingsPath = userSettingsPath(deps.env, deps.homeDir);
	const store = await openKeychain(
		deps,
		(await readSettingsEnv(settingsPath)).HARNESSFORCE_WORKSPACE_ID,
	);
	const revoke = revokeHashes(store);
	// 発行した後に保存で失敗し、再実行のたびにkeyを入れ替えることを避けるため、ログインの前に確かめる。
	const settings = await readUserSettings(settingsPath);
	if (
		settings.kind === "invalid" ||
		!hasWritableMarketplaces(settings.settings)
	)
		stop("settingsUnreadable");
	const authorizationEndpoint =
		(await discoverAuthorizationEndpoint(base, deps.fetch)) ?? stop("network");
	const secrets = createLoginSecrets();
	const { code, redirectUri, loopback } = await logIn(
		authorizationEndpoint,
		secrets,
		port,
		new URL(recordedUrl).origin,
		deps,
	);
	// callbackへの応答は、結果が決まるまで保留している。どの終端でも完了画面へ移して閉じる。
	let completion: CompletionStatus = "failed";
	try {
		const outcome = await requestCredentials(
			base,
			{
				code,
				code_verifier: secrets.codeVerifier,
				client_id: CLIENT_ID,
				redirect_uri: redirectUri,
				revoke_key_hashes: revoke.keyHashes,
				revoke_api_token_hashes: revoke.apiTokenHashes,
			},
			deps.fetch,
		);
		if (outcome.kind === "viewer") completion = "viewer";
		const issued = issuedOrStop(outcome);
		const isPluginAutoUpdateOn = await save(
			issued,
			recordedUrl,
			settingsPath,
			args,
			store,
		).catch((error: unknown) => {
			if (isStop(error)) throw error;
			return stop("saveFailed");
		});
		const codexPath = codexConfigPath(deps.env, deps.homeDir);
		await saveCodexConfig(
			issued,
			recordedUrl,
			codexPath,
			args.sendContent,
		).catch(() => stop("codexSaveFailed"));
		completion = "connected";
		loopback.finish({ status: completion, workspaceId: issued.workspaceId });
		return finishInit(issued, args, deps, {
			codexPath,
			connection: recordedUrl,
			isKernelKeyring: store.isKernelKeyring,
			isPluginAutoUpdateOn,
		});
	} finally {
		loopback.finish({ status: completion });
	}
}

function finishInit(
	issued: Issued,
	args: InitArgs,
	deps: InitDeps,
	result: {
		codexPath: string;
		connection: string;
		isKernelKeyring: boolean;
		isPluginAutoUpdateOn: boolean;
	},
) {
	// 発行と保存は済んでいるため、Workspaceが本文を保存しないことを失敗とせず、設定の場所を示す。
	deps.stdout(`${contentNotice(issued.content, args.sendContent)}\n`);
	return result;
}

// correlation.md「CLI」の手順1と「実行環境」。保存先を選び、既存の項目を読む。
// previousWorkspaceIdはuser settingsの前回のinitのWorkspaceで、項目を列挙できないkernelのkeyringから読む。
async function openKeychain(
	deps: InitDeps,
	previousWorkspaceId: string | undefined,
): Promise<InitKeychain> {
	const store = await deps.keychain
		.openForInit({
			previousWorkspaceId,
			onWaiting: (provider) => {
				deps.stderr(`${INIT_MESSAGES.waitingForSecretService}\n`);
				if (provider?.isKWallet)
					deps.stderr(`${kwalletUnlockHint(provider.walletLabel)}\n`);
			},
		})
		.catch(() => stop("keychainUnavailable"));
	return store ?? stopWith(keychainUnavailableMessage(deps.keychain));
}

// keychainの利用者用IngestKeyすべてのhashと、ApiTokenすべてのrefresh tokenのhash。
function revokeHashes({ items }: InitKeychain): {
	keyHashes: string[];
	apiTokenHashes: string[];
} {
	const keyHashes = items
		.filter((item) => isIngestKeyAccount(item.account))
		.map((item) => sha256Hex(item.secret));
	if (keyHashes.length > MAX_REVOKE_HASHES) stop("tooManyKeys");
	const apiTokenHashes = items.flatMap((item) => {
		const workspaceId = apiTokenWorkspaceId(item.account);
		const token =
			workspaceId === undefined
				? undefined
				: parseStoredApiToken(item.secret, workspaceId);
		return token ? [sha256Hex(token.refreshToken)] : [];
	});
	if (apiTokenHashes.length > MAX_REVOKE_HASHES) stop("tooManyCredentials");
	return { keyHashes, apiTokenHashes };
}

async function logIn(
	authorizationEndpoint: URL,
	secrets: LoginSecrets,
	port: number,
	webOrigin: string,
	deps: InitDeps,
): Promise<{ code: string; redirectUri: string; loopback: Loopback }> {
	const loopback = await deps
		.startLoopback({
			state: secrets.state,
			timeoutMs: deps.callbackTimeoutMs,
			port,
			webOrigin,
		})
		.catch(() => stopWith(listenFailedMessage(port)));
	const authorization = new URL(authorizationEndpoint);
	for (const [name, value] of Object.entries({
		response_type: "code",
		client_id: CLIENT_ID,
		redirect_uri: loopback.redirectUri,
		code_challenge: secrets.codeChallenge,
		code_challenge_method: "S256",
		state: secrets.state,
	}))
		authorization.searchParams.set(name, value);
	if (!(await deps.openBrowser(authorization.href)))
		deps.stderr(`${authorization.href}\n`);
	const callback = (await loopback.callback) ?? stop("timeout");
	try {
		return {
			code: codeOrStop(callback, secrets.state),
			redirectUri: loopback.redirectUri,
			loopback,
		};
	} catch (error) {
		loopback.finish({ status: callbackFailure(callback, secrets.state) });
		throw error;
	}
}

// stateを最初に照合し、一致しなければerrorの値によらずログインの失敗とする。
function callbackFailure(callback: Callback, state: string): CompletionStatus {
	if (callback.state !== state) return "failed";
	if (callback.error === "access_denied") return "denied";
	if (callback.error === "no_workspace") return "no_workspace";
	return "failed";
}

function codeOrStop(callback: Callback, state: string): string {
	if (callback.state !== state) return stop("loginFailed");
	if (callback.error === "access_denied") return stop("accessDenied");
	if (callback.error === "no_workspace") return stop("noWorkspace");
	if (callback.error || !callback.code) return stop("loginFailed");
	return callback.code;
}

function issuedOrStop(outcome: CredentialOutcome): Issued {
	switch (outcome.kind) {
		case "issued":
			return outcome.issued;
		case "invalid_grant":
			return stop("loginFailed");
		case "viewer":
			return stop("viewer");
		case "limit":
			return stop(
				outcome.role === "member" ? "limitMember" : "limitOwnerAdmin",
			);
		case "gate_unavailable":
			return stop("gateUnavailable");
		case "ingest_unavailable":
			return stop("ingestUnavailable");
		case "unexpected":
			return stop("network");
	}
}

// correlation.md「CLI」の手順5と6。どちらかが失敗したら保存の失敗とする。
// originを先に消し、途中で失敗しても前の接続先のoriginと新しいkeyやtokenの組を残さない。
// pluginの自動更新が有効になったかを返す。
async function save(
	issued: Issued,
	connection: string,
	settingsPath: string,
	args: Pick<InitArgs, "sendContent" | "noPluginAutoUpdate">,
	store: InitKeychain,
): Promise<boolean> {
	await store.delete(ingestOriginAccount(issued.workspaceId));
	await store.delete(urlOriginAccount(issued.workspaceId));
	await store.set(ingestKeyAccount(issued.workspaceId), issued.ingestKey);
	await store.set(
		apiTokenAccount(issued.workspaceId),
		serializeApiToken(issued.apiToken),
	);
	await store.set(
		ingestOriginAccount(issued.workspaceId),
		new URL(issued.ingestEndpoint).origin,
	);
	await store.set(
		urlOriginAccount(issued.workspaceId),
		new URL(connection).origin,
	);
	// 読み出しはkernelのkeyringを先に選ぶため、Secret Serviceへ保存したら古いkernelのkeyringの項目を残さない。
	await store.deleteElsewhere(issued.workspaceId);
	const current = await readUserSettings(settingsPath);
	if (current.kind === "invalid" || !hasWritableMarketplaces(current.settings))
		return stop("saveFailed");
	const env: Record<string, string> = {
		HARNESSFORCE_URL: connection,
		HARNESSFORCE_ENDPOINT: issued.ingestEndpoint,
		OTEL_EXPORTER_OTLP_ENDPOINT: issued.ingestEndpoint,
		HARNESSFORCE_WORKSPACE_ID: issued.workspaceId,
		CLAUDE_CODE_ENABLE_TELEMETRY: "1",
		CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
		OTEL_METRICS_INCLUDE_ENTRYPOINT: "true",
		OTEL_METRICS_EXPORTER: "otlp",
		OTEL_LOGS_EXPORTER: "otlp",
		OTEL_TRACES_EXPORTER: "otlp",
		OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
	};
	Object.assign(env, contentEnv(issued.content, args.sendContent));
	const { settings, isOn } = withPluginAutoUpdate(
		mergeUserSettings(current.settings, env),
		args.noPluginAutoUpdate,
	);
	await writeUserSettings(settingsPath, settings);
	return isOn;
}

// correlation.md「CLI」の手順6。送らない区分も明示に`0`で書く。
// 未設定の変数がagentの既定や他の変数に従って、選んでいない区分の本文が届かないようにするため。
// `OTEL_LOG_ASSISTANT_RESPONSES`は未設定だと`OTEL_LOG_USER_PROMPTS`に従う。
function contentEnv(
	content: ContentSettings,
	sendContent: boolean,
): Record<string, string> {
	const flag = (isStored: boolean) => (sendContent && isStored ? "1" : "0");
	const modelAndTools = flag(content.isModelAndToolsStored);
	return {
		OTEL_LOG_USER_PROMPTS: flag(content.isPromptsStored),
		OTEL_LOG_ASSISTANT_RESPONSES: modelAndTools,
		OTEL_LOG_TOOL_DETAILS: modelAndTools,
		OTEL_LOG_TOOL_CONTENT: modelAndTools,
	};
}

function contentNotice(content: ContentSettings, sendContent: boolean): string {
	if (!sendContent) return INIT_MESSAGES.contentNotSent;
	return content.isPromptsStored || content.isModelAndToolsStored
		? contentEnabledMessage(content)
		: INIT_MESSAGES.contentNotStored;
}

// correlation.md「Codex」: 利用者用のIngestKeyだけを書く。ApiTokenは書かない。
async function saveCodexConfig(
	issued: Issued,
	connection: string,
	path: string,
	sendContent: boolean,
): Promise<void> {
	const merged = mergeCodexConfig(await readCodexConfig(path), {
		connection,
		ingestEndpoint: issued.ingestEndpoint,
		ingestKey: issued.ingestKey,
		logUserPrompt: sendContent && issued.content.isPromptsStored,
		logAgentResponses: sendContent && issued.content.isModelAndToolsStored,
	});
	await writeCodexConfig(path, merged);
}
