import {
	COLLECT_BUDGET_MS,
	collectConfig,
} from "@harnessforce/agent-core/config/collect";
import {
	INVALID_ENDPOINT_WARNING,
	notConfiguredWarning,
	REGISTRATION_FAILED_WARNING,
} from "@harnessforce/agent-core/hook-warning";
import {
	type Destination,
	type IngestItem,
	type IngestPath,
	ingestBaseFrom,
	type KeyKind,
	postItem,
	type SendOutcome,
} from "@harnessforce/agent-core/ingest";
import { isIssueIdentifier } from "@harnessforce/agent-core/issue";
import { readManagedEnv } from "@harnessforce/agent-core/managed";
import type { RunGit } from "@harnessforce/agent-core/process/git";
import { sessionContext } from "@harnessforce/agent-core/session-context";
import type { Env, Fetch } from "@harnessforce/agent-core/types";
import { resolveProjectRoot, resolveVcs } from "@harnessforce/agent-core/vcs";
import type {
	ConfigSnapshot,
	SessionRegistration,
} from "@harnessforce/semconv";
import { type HookInput, parseHookInput } from "./input.js";
import {
	claimFirstPrompt,
	isFirstPromptSent,
	isMarkedUnauthorized,
	loadRegistration,
	markUnauthorized,
	type Scratchpad,
	saveRegistration,
} from "./scratchpad.js";
import type { UserKeyRead } from "./user-key.js";

export type HookDeps = {
	env: Env;
	now: () => Date;
	git: RunGit;
	fetch: Fetch;
	stdout: (text: string) => void;
	stderr: (text: string) => void;
	homeDir: string;
	managedDir: string;
	// `harnessforce otel-headers`を起動してkeychainの利用者用IngestKeyを読む。
	readUserKey: (cwd: string) => Promise<UserKeyRead>;
};

// correlation.md「hook」の共通の規則が、選んだkeyの種類ごとに定める文言。
const REVOKED_KEY_MESSAGES: Record<KeyKind, string> = {
	user: "送信キーが失効しています。`harnessforce init`を実行してください",
	workspace:
		"組織の送信キーが失効しています。Workspaceの管理者に連絡してください",
};

// resumeとcompactは同じsessionの継続なので送らない。未知のsourceも送らない。
const REGISTERING_SOURCES = new Set(["startup", "clear", "fork"]);

const logError = (deps: HookDeps) => (error: unknown) =>
	deps.stderr(
		`harnessforce: ${error instanceof Error ? error.message : String(error)}\n`,
	);

type Subject = "session registration" | "config snapshot";
const report = (deps: HookDeps, subject: Subject, detail: string) =>
	deps.stderr(`harnessforce: ${subject} ${detail}\n`);

// 利用者用のkeyは、`harnessforce otel-headers`が送信先の固定を確かめたうえで返す。
async function selectUserKey(
	deps: HookDeps,
	cwd: string,
): Promise<string | undefined> {
	if (!deps.env.HARNESSFORCE_WORKSPACE_ID) return undefined;
	const read = await deps.readUserKey(cwd);
	if (read.kind === "failed")
		deps.stderr("harnessforce: no user key in keychain or read failed\n");
	return read.kind === "found" ? read.key : undefined;
}

// 送れない理由が利用者の設定にあるときだけwarningを返す（correlation.md「hookの警告」）。
type Resolved = { destination?: Destination; warning?: string };

// Workspace用のkeyとその送信先はmanaged settingsのfileからだけ読む。processの環境変数はrepositoryのsettingsが書けるためである。
// Workspace用のkeyが無ければ、processの環境変数の送信先と利用者用のkeyを使う。
// 送信先の判定をkeyの判定より先に行い、両方が無ければ送信先の終端だけを書く。警告は、未設定を送信先の不正より先に判定する。
async function resolveDestination(
	deps: HookDeps,
	cwd: string,
): Promise<Resolved> {
	const managed = await readManagedEnv(deps.managedDir, [
		"HARNESSFORCE_INGEST_KEY",
		"HARNESSFORCE_ENDPOINT",
	]);
	const workspaceKey = managed.HARNESSFORCE_INGEST_KEY;
	const endpoint = workspaceKey
		? managed.HARNESSFORCE_ENDPOINT
		: deps.env.HARNESSFORCE_ENDPOINT;
	const notConfigured =
		!endpoint || !(workspaceKey || deps.env.HARNESSFORCE_WORKSPACE_ID);
	const ingestBase = ingestBaseFrom(endpoint);
	if (!ingestBase) {
		report(deps, "session registration", "skipped (invalid endpoint)");
		return {
			warning: notConfigured
				? notConfiguredWarning("claude_code")
				: INVALID_ENDPOINT_WARNING,
		};
	}
	if (workspaceKey)
		return {
			destination: { ingestBase, key: workspaceKey, keyKind: "workspace" },
		};
	const userKey = await selectUserKey(deps, cwd);
	if (!userKey) {
		report(deps, "session registration", "skipped (no ingest key)");
		// WORKSPACE_IDがあるのにkeyが無い端末は、otelHeadersHelperの通知と重ねない。
		return notConfigured
			? { warning: notConfiguredWarning("claude_code") }
			: {};
	}
	return { destination: { ingestBase, key: userKey, keyKind: "user" } };
}

// Workspace用のkeyではsource=cliを名乗らない（control-plane.md「認証の種類と信頼」）。
function registrationSource(
	destination: Destination,
	env: Env,
): Pick<SessionRegistration, "source" | "issue_identifier"> {
	const issue = env.HARNESSFORCE_ISSUE;
	return destination.keyKind === "user" && issue && isIssueIdentifier(issue)
		? { source: "cli", issue_identifier: issue }
		: { source: "hook" };
}

async function send(
	destination: Destination,
	path: IngestPath,
	item: IngestItem,
	subject: Subject,
	deps: HookDeps,
): Promise<SendOutcome> {
	const outcome = await postItem(destination, path, item, deps.fetch);
	if (outcome.kind === "failed")
		report(deps, subject, `failed (${outcome.reason})`);
	return outcome;
}

// 同じsessionで表示は1回まで。SessionStartで登録とsnapshotの両方が401でも1回だけ呼ぶ。
// exit 0のhookのstderrは利用者に届かないため、呼び出し側が返した文言をsystemMessageでも示す。
async function reportRevokedKey(
	destination: Destination,
	pad: Scratchpad | undefined,
	deps: HookDeps,
): Promise<string> {
	const message = REVOKED_KEY_MESSAGES[destination.keyKind];
	deps.stderr(`${message}\n`);
	if (pad) await markUnauthorized(pad).catch(logError(deps));
	return message;
}

// stdoutはJSONのobject1つだけとする（correlation.md「hook」）。JSONの出力はstdoutがそのobjectだけのときに解釈される。
const writeJson = (deps: HookDeps, output: object) =>
	deps.stdout(`${JSON.stringify(output)}\n`);

async function registerSession(
	input: HookInput,
	destination: Destination,
	deps: HookDeps,
): Promise<SendOutcome | undefined> {
	const vcs = await resolveVcs(input.cwd, deps.git);
	if (!vcs) return undefined;
	const registration: SessionRegistration = {
		agent: "claude_code",
		session_id: input.sessionId,
		...vcs,
		...registrationSource(destination, deps.env),
		started_at: deps.now().toISOString(),
	};
	// 保存に失敗しても登録は送る。UserPromptSubmitはこの保存が無ければ送らない。
	if (input.scratchpad)
		await saveRegistration(input.scratchpad, registration).catch(
			logError(deps),
		);
	return send(
		destination,
		"v1/sessions",
		registration,
		"session registration",
		deps,
	);
}

// gitのrepositoryの外でも送る。componentsが0件なら送らない。
async function sendConfigSnapshot(
	input: HookInput,
	destination: Destination,
	deps: HookDeps,
): Promise<SendOutcome | undefined> {
	// 収集の開始はproject rootを求める前とする（correlation.md「構成の収集」）。
	const startedMs = deps.now().getTime();
	const projectRoot = await resolveProjectRoot(input.cwd, deps.git);
	const result = await collectConfig({
		projectRoot,
		homeDir: deps.homeDir,
		managedDir: deps.managedDir,
		env: deps.env,
		isExpired: () => deps.now().getTime() - startedMs > COLLECT_BUDGET_MS,
	});
	if (result.kind === "skipped") {
		report(deps, "config snapshot", `skipped (${result.reason})`);
		return undefined;
	}
	if (result.components.length === 0) return undefined;
	const snapshot: ConfigSnapshot = {
		agent: "claude_code",
		session_id: input.sessionId,
		components: result.components,
	};
	return send(
		destination,
		"v1/config-snapshots",
		snapshot,
		"config snapshot",
		deps,
	);
}

// 利用者へ表示する1行。401のkeyの文言を、送信の失敗と設定の警告より優先する。
async function sendSessionStart(
	input: HookInput,
	deps: HookDeps,
): Promise<string | undefined> {
	if (input.source !== undefined && !REGISTERING_SOURCES.has(input.source))
		return undefined;
	if (input.scratchpad && (await isMarkedUnauthorized(input.scratchpad)))
		return undefined;
	const { destination, warning } = await resolveDestination(deps, input.cwd);
	if (!destination) return warning;
	const [registration, snapshot] = await Promise.all([
		registerSession(input, destination, deps).catch(logError(deps)),
		sendConfigSnapshot(input, destination, deps).catch(logError(deps)),
	]);
	if (
		[registration, snapshot].some((outcome) => outcome?.kind === "unauthorized")
	)
		return reportRevokedKey(destination, input.scratchpad, deps);
	return registration?.kind === "failed"
		? REGISTRATION_FAILED_WARNING
		: undefined;
}

// sourceや送信の結果によらず、session contextを必ず1回出す。resumeとcompactの後のcontextにもsession IDを残すためである。
async function onSessionStart(input: HookInput, deps: HookDeps): Promise<void> {
	const message = await sendSessionStart(input, deps).catch((error) => {
		logError(deps)(error);
		return undefined;
	});
	writeJson(deps, {
		...sessionContext(input.sessionId),
		...(message === undefined ? {} : { systemMessage: message }),
	});
}

// sessionの最初のpromptだけ、SessionStartが保存した登録にprompt_idを加えて送る。SessionStartの送信の再送を兼ねる。
async function onUserPromptSubmit(
	input: HookInput,
	deps: HookDeps,
): Promise<void> {
	const pad = input.scratchpad;
	if (!input.promptId || !pad || (await isMarkedUnauthorized(pad))) return;
	const saved = await loadRegistration(pad);
	if (!saved || (await isFirstPromptSent(pad))) return;
	const { destination } = await resolveDestination(deps, input.cwd);
	if (!destination || !(await claimFirstPrompt(pad))) return;
	const outcome = await send(
		destination,
		"v1/sessions",
		{ ...saved, first_prompt_id: input.promptId },
		"session registration",
		deps,
	);
	if (outcome.kind === "unauthorized")
		writeJson(deps, {
			systemMessage: await reportRevokedKey(destination, pad, deps),
		});
}

type Handler = (input: HookInput, deps: HookDeps) => Promise<void>;
const HANDLERS = new Map<string, Handler>([
	["session-start", onSessionStart],
	["user-prompt-submit", onUserPromptSubmit],
]);

export async function runHook(
	event: string,
	rawInput: string,
	deps: HookDeps,
): Promise<void> {
	const handler = HANDLERS.get(event);
	const input = parseHookInput(rawInput);
	if (!handler || !input) return;
	// fail-open: どの失敗でもsessionを止めない。stderrはdebug logにだけ出る。
	await handler(input, deps).catch(logError(deps));
}
