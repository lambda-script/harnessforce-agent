import { collectConfig } from "../../../packages/cli/src/config/collect.js";
import type { ConfigSnapshot } from "../../../packages/semconv/src/schemas/config-snapshot.js";
import type { SessionRegistration } from "../../../packages/semconv/src/schemas/session-registration.js";
import {
	type Destination,
	type Env,
	type Fetch,
	type IngestPath,
	ingestBaseFrom,
	type KeyKind,
	postItem,
	type SendOutcome,
	selectKey,
} from "./destination.js";
import { type HookInput, parseHookInput } from "./input.js";
import {
	claimFirstPrompt,
	isMarkedUnauthorized,
	loadRegistration,
	markUnauthorized,
	type Scratchpad,
	saveRegistration,
} from "./scratchpad.js";
import { type RunGit, resolveProjectRoot, resolveVcs } from "./vcs.js";

export type HookDeps = {
	env: Env;
	now: () => Date;
	git: RunGit;
	fetch: Fetch;
	stdout: (text: string) => void;
	stderr: (text: string) => void;
	homeDir: string;
	managedDir: string;
};

// correlation.md「hook」の共通の規則が、選んだkeyの種類ごとに定める文言。
const REVOKED_KEY_MESSAGES: Record<KeyKind, string> = {
	workspace:
		"組織の送信キーが失効しています。Workspaceの管理者に連絡してください",
};

// resumeとcompactは同じsessionの継続なので送らない。未知のsourceも送らない。
const REGISTERING_SOURCES = new Set(["startup", "clear", "fork"]);
// correlation.md「構成の収集」: 収集の開始からの上限時間。
const COLLECT_BUDGET_MS = 1000;

const logError = (deps: HookDeps) => (error: unknown) =>
	deps.stderr(
		`harnessforce: ${error instanceof Error ? error.message : String(error)}\n`,
	);

type Subject = "session registration" | "config snapshot";
const report = (deps: HookDeps, subject: Subject, detail: string) =>
	deps.stderr(`harnessforce: ${subject} ${detail}\n`);

// 送信先の判定をkeyの判定より先に行う。両方が無ければ送信先の終端だけを書く。
function resolveDestination(deps: HookDeps): Destination | undefined {
	const ingestBase = ingestBaseFrom(deps.env.HARNESSFORCE_ENDPOINT);
	if (!ingestBase) {
		report(deps, "session registration", "skipped (invalid endpoint)");
		return undefined;
	}
	const selected = selectKey(deps.env);
	if (!selected) {
		report(deps, "session registration", "skipped (no ingest key)");
		return undefined;
	}
	return { ingestBase, ...selected };
}

async function send(
	destination: Destination,
	path: IngestPath,
	item: unknown,
	subject: Subject,
	deps: HookDeps,
): Promise<SendOutcome> {
	const outcome = await postItem(destination, path, item, deps.fetch);
	if (outcome.kind === "failed")
		report(deps, subject, `failed (${outcome.reason})`);
	return outcome;
}

// 同じsessionで表示は1回まで。SessionStartで登録とsnapshotの両方が401でも1回だけ呼ぶ。
async function notifyRevokedKey(
	destination: Destination,
	pad: Scratchpad | undefined,
	deps: HookDeps,
): Promise<void> {
	const message = REVOKED_KEY_MESSAGES[destination.keyKind];
	deps.stderr(`${message}\n`);
	// exit 0のhookのstderrは利用者に届かないため、systemMessageでも示す。
	deps.stdout(`${JSON.stringify({ systemMessage: message })}\n`);
	if (pad) await markUnauthorized(pad).catch(logError(deps));
}

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
		source: "hook",
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
	const projectRoot = await resolveProjectRoot(input.cwd, deps.git);
	const startedMs = deps.now().getTime();
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

async function onSessionStart(input: HookInput, deps: HookDeps): Promise<void> {
	if (input.source !== undefined && !REGISTERING_SOURCES.has(input.source))
		return;
	if (input.scratchpad && (await isMarkedUnauthorized(input.scratchpad)))
		return;
	const destination = resolveDestination(deps);
	if (!destination) return;
	const outcomes = await Promise.all([
		registerSession(input, destination, deps).catch(logError(deps)),
		sendConfigSnapshot(input, destination, deps).catch(logError(deps)),
	]);
	if (outcomes.some((outcome) => outcome?.kind === "unauthorized"))
		await notifyRevokedKey(destination, input.scratchpad, deps);
}

// sessionの最初のpromptだけ、SessionStartが保存した登録にprompt_idを加えて送る。SessionStartの送信の再送を兼ねる。
async function onUserPromptSubmit(
	input: HookInput,
	deps: HookDeps,
): Promise<void> {
	const pad = input.scratchpad;
	if (!input.promptId || !pad || (await isMarkedUnauthorized(pad))) return;
	const saved = await loadRegistration(pad);
	if (!saved) return;
	const destination = resolveDestination(deps);
	if (!destination || !(await claimFirstPrompt(pad))) return;
	const outcome = await send(
		destination,
		"v1/sessions",
		{ ...saved, first_prompt_id: input.promptId },
		"session registration",
		deps,
	);
	if (outcome.kind === "unauthorized")
		await notifyRevokedKey(destination, pad, deps);
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
