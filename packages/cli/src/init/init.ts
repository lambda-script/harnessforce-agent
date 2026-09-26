import { createHash } from "node:crypto";
import {
	apiTokenAccount,
	ingestKeyAccount,
	ingestOriginAccount,
	isIngestKeyAccount,
	type Keychain,
} from "../credentials/keychain.js";
import type { Env } from "../otel-headers.js";
import { parseAllowedUrl } from "../url.js";
import {
	type CredentialOutcome,
	type Issued,
	requestCredentials,
} from "./credentials-api.js";
import type { Fetch } from "./http.js";
import type { Callback, startLoopback } from "./loopback.js";
import { INIT_MESSAGES, type InitMessage } from "./messages.js";
import { discoverAuthorizationEndpoint } from "./metadata.js";
import { createLoginSecrets, type LoginSecrets } from "./pkce.js";
import {
	mergeUserSettings,
	readUserSettings,
	userSettingsPath,
	writeUserSettings,
} from "./settings.js";

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

// apps/webがあらかじめ登録した固定のpublic client。
const CLIENT_ID = "harnessforce-cli";
// POST /api/v1/cli/credentialsが受け付けるrevoke_key_hashesの上限。
const MAX_REVOKE_KEY_HASHES = 100;

// 途中の終端はこの値で抜け、表示と終了コードを1か所で決める。
class InitStop {
	constructor(readonly message: InitMessage) {}
}
const stop = (message: InitMessage): never => {
	throw new InitStop(message);
};

const sha256Hex = (value: string) =>
	createHash("sha256").update(value, "utf8").digest("hex");

export async function init(
	url: string | undefined,
	deps: InitDeps,
): Promise<number> {
	try {
		await runInit(url, deps);
		deps.stdout(`${INIT_MESSAGES.success}\n`);
		return 0;
	} catch (error) {
		if (!(error instanceof InitStop)) throw error;
		deps.stderr(`${INIT_MESSAGES[error.message]}\n`);
		return 1;
	}
}

async function runInit(url: string | undefined, deps: InitDeps) {
	const base = parseAllowedUrl(url ?? deps.defaultUrl) ?? stop("invalidUrl");
	// settingsへは送信先と同じくscheme、host、port、pathだけを書き、userinfoを残さない。
	const recordedUrl = `${base.origin}${base.pathname.replace(/\/+$/, "")}`;
	const revokeKeyHashes = await readRevokeKeyHashes(deps.keychain);
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
		deps,
	);
	const outcome = await requestCredentials(
		base,
		{
			code,
			code_verifier: secrets.codeVerifier,
			client_id: CLIENT_ID,
			redirect_uri: redirectUri,
			revoke_key_hashes: revokeKeyHashes,
		},
		deps.fetch,
	);
	const issued = issuedOrStop(outcome);
	await save(issued, recordedUrl, settingsPath, deps).catch((error: unknown) =>
		stop(error instanceof InitStop ? error.message : "saveFailed"),
	);
}

async function readRevokeKeyHashes(keychain: Keychain): Promise<string[]> {
	if (!(await keychain.isAvailable())) stop("keychainUnavailable");
	const items =
		(await keychain.list().catch(() => undefined)) ??
		stop("keychainUnavailable");
	const hashes = items
		.filter((item) => isIngestKeyAccount(item.account))
		.map((item) => sha256Hex(item.secret));
	return hashes.length > MAX_REVOKE_KEY_HASHES ? stop("tooManyKeys") : hashes;
}

async function logIn(
	authorizationEndpoint: URL,
	secrets: LoginSecrets,
	deps: InitDeps,
): Promise<{ code: string; redirectUri: string }> {
	const loopback = await deps
		.startLoopback({ state: secrets.state, timeoutMs: deps.callbackTimeoutMs })
		.catch(() => stop("listenFailed"));
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
// originを先に消し、途中で失敗しても前の接続先のoriginと新しいkeyの組を残さない。
async function save(
	issued: Issued,
	connection: string,
	settingsPath: string,
	deps: InitDeps,
): Promise<void> {
	await deps.keychain.delete(ingestOriginAccount(issued.workspaceId));
	await deps.keychain.set(
		ingestKeyAccount(issued.workspaceId),
		issued.ingestKey,
	);
	await deps.keychain.set(apiTokenAccount(issued.workspaceId), issued.apiToken);
	await deps.keychain.set(
		ingestOriginAccount(issued.workspaceId),
		new URL(issued.ingestEndpoint).origin,
	);
	const current = await readUserSettings(settingsPath);
	if (current.kind === "invalid") return stop("saveFailed");
	await writeUserSettings(
		settingsPath,
		mergeUserSettings(current.settings, {
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
		}),
	);
}
