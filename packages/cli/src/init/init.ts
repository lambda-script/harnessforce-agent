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
	ingestKeyAccount,
	ingestOriginAccount,
	isIngestKeyAccount,
	type Keychain,
	urlOriginAccount,
} from "../credentials/keychain.js";
import {
	INIT_MESSAGES,
	type InitMessage,
	listenFailedMessage,
} from "../shared/messages.js";
import { discoverAuthorizationEndpoint } from "../shared/metadata.js";
import {
	mergeUserSettings,
	readUserSettings,
	userSettingsPath,
	writeUserSettings,
} from "../shared/settings.js";
import { isStop, runUntilStop, stopWith } from "../shared/stop.js";
import {
	type CredentialOutcome,
	type Issued,
	requestCredentials,
} from "./credentials-api.js";
import type { Callback, startLoopback } from "./loopback.js";
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

// `hf init`の引数。portが無ければloopbackのcallback portの既定を使う。
export type InitArgs = {
	url: string | undefined;
	port: number | undefined;
	sendContent: boolean;
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
		await runInit(args, deps);
		deps.stdout(`${INIT_MESSAGES.success}\n`);
		return 0;
	}, deps.stderr);
}

async function runInit(args: InitArgs, deps: InitDeps) {
	const port = args.port ?? DEFAULT_PORT;
	const base =
		parseAllowedUrl(args.url ?? deps.defaultUrl) ?? stop("invalidUrl");
	// settingsへは送信先と同じくscheme、host、port、pathだけを書き、userinfoを残さない。
	const recordedUrl = withoutExtras(base);
	const revoke = await readRevokeHashes(deps.keychain);
	const settingsPath = userSettingsPath(deps.env, deps.homeDir);
	// 発行した後に保存で失敗し、再実行のたびにkeyを入れ替えることを避けるため、ログインの前に確かめる。
	if ((await readUserSettings(settingsPath)).kind === "invalid")
		stop("settingsUnreadable");
	const authorizationEndpoint =
		(await discoverAuthorizationEndpoint(base, deps.fetch)) ?? stop("network");
	const secrets = createLoginSecrets();
	const { code, redirectUri } = await logIn(
		authorizationEndpoint,
		secrets,
		port,
		deps,
	);
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
	const issued = issuedOrStop(outcome);
	await save(issued, recordedUrl, settingsPath, args.sendContent, deps).catch(
		(error: unknown) => {
			if (isStop(error)) throw error;
			return stop("saveFailed");
		},
	);
	// 発行と保存は済んでいるため、本文のopt-inが無いことを失敗とせず、opt-inの場所を示す。
	if (args.sendContent && !issued.contentOptIn)
		deps.stdout(`${INIT_MESSAGES.contentNotOptedIn}\n`);
}

// correlation.md「CLI」の手順1。keychainの利用者用IngestKeyすべてのhashと、ApiTokenすべてのrefresh tokenのhash。
async function readRevokeHashes(
	keychain: Keychain,
): Promise<{ keyHashes: string[]; apiTokenHashes: string[] }> {
	if (!(await keychain.isAvailable())) stop("keychainUnavailable");
	const items =
		(await keychain.list().catch(() => undefined)) ??
		stop("keychainUnavailable");
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
	deps: InitDeps,
): Promise<{ code: string; redirectUri: string }> {
	const loopback = await deps
		.startLoopback({
			state: secrets.state,
			timeoutMs: deps.callbackTimeoutMs,
			port,
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
	return {
		code: codeOrStop(callback, secrets.state),
		redirectUri: loopback.redirectUri,
	};
}

// stateを最初に照合し、一致しなければerrorの値によらずログインの失敗とする。
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
async function save(
	issued: Issued,
	connection: string,
	settingsPath: string,
	sendContent: boolean,
	deps: InitDeps,
): Promise<void> {
	await deps.keychain.delete(ingestOriginAccount(issued.workspaceId));
	await deps.keychain.delete(urlOriginAccount(issued.workspaceId));
	await deps.keychain.set(
		ingestKeyAccount(issued.workspaceId),
		issued.ingestKey,
	);
	await deps.keychain.set(
		apiTokenAccount(issued.workspaceId),
		serializeApiToken(issued.apiToken),
	);
	await deps.keychain.set(
		ingestOriginAccount(issued.workspaceId),
		new URL(issued.ingestEndpoint).origin,
	);
	await deps.keychain.set(
		urlOriginAccount(issued.workspaceId),
		new URL(connection).origin,
	);
	const current = await readUserSettings(settingsPath);
	if (current.kind === "invalid") return stop("saveFailed");
	const env: Record<string, string> = {
		HARNESSFORCE_URL: connection,
		HARNESSFORCE_ENDPOINT: issued.ingestEndpoint,
		OTEL_EXPORTER_OTLP_ENDPOINT: issued.ingestEndpoint,
		HARNESSFORCE_WORKSPACE_ID: issued.workspaceId,
		CLAUDE_CODE_ENABLE_TELEMETRY: "1",
		CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
		OTEL_METRICS_EXPORTER: "otlp",
		OTEL_LOGS_EXPORTER: "otlp",
		OTEL_TRACES_EXPORTER: "otlp",
		OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
	};
	if (sendContent && issued.contentOptIn) env.OTEL_LOG_USER_PROMPTS = "1";
	await writeUserSettings(
		settingsPath,
		mergeUserSettings(current.settings, env),
	);
}
