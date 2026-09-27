import type { SessionRegistration } from "../../../packages/semconv/src/schemas/session-registration.js";
import {
	type Destination,
	type Env,
	type Fetch,
	type KeyKind,
	postRegistration,
	selectKey,
	sessionsUrlFrom,
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
import { type RunGit, resolveVcs } from "./vcs.js";

export type HookDeps = {
	env: Env;
	now: () => Date;
	git: RunGit;
	fetch: Fetch;
	stdout: (text: string) => void;
	stderr: (text: string) => void;
};

// correlation.md「hook」の共通の規則が、選んだkeyの種類ごとに定める文言。
const REVOKED_KEY_MESSAGES: Record<KeyKind, string> = {
	workspace:
		"組織の送信キーが失効しています。Workspaceの管理者に連絡してください",
};

// resumeとcompactは同じsessionの継続なので送らない。未知のsourceも送らない。
const REGISTERING_SOURCES = new Set(["startup", "clear", "fork"]);

const logError = (deps: HookDeps) => (error: unknown) =>
	deps.stderr(
		`harnessforce: ${error instanceof Error ? error.message : String(error)}\n`,
	);

const report = (deps: HookDeps, detail: string) =>
	deps.stderr(`harnessforce: session registration ${detail}\n`);

// 送信先の判定をkeyの判定より先に行う。両方が無ければ送信先の終端だけを書く。
function resolveDestination(deps: HookDeps): Destination | undefined {
	const sessionsUrl = sessionsUrlFrom(deps.env.HARNESSFORCE_ENDPOINT);
	if (!sessionsUrl) {
		report(deps, "skipped (invalid endpoint)");
		return undefined;
	}
	const selected = selectKey(deps.env);
	if (!selected) {
		report(deps, "skipped (no ingest key)");
		return undefined;
	}
	return { sessionsUrl, ...selected };
}

async function send(
	destination: Destination,
	registration: SessionRegistration,
	pad: Scratchpad | undefined,
	deps: HookDeps,
): Promise<void> {
	const outcome = await postRegistration(destination, registration, deps.fetch);
	if (outcome.kind === "failed") report(deps, `failed (${outcome.reason})`);
	if (outcome.kind !== "unauthorized") return;
	const message = REVOKED_KEY_MESSAGES[destination.keyKind];
	deps.stderr(`${message}\n`);
	// exit 0のhookのstderrは利用者に届かないため、systemMessageでも示す。
	deps.stdout(`${JSON.stringify({ systemMessage: message })}\n`);
	if (pad) await markUnauthorized(pad).catch(logError(deps));
}

async function onSessionStart(input: HookInput, deps: HookDeps): Promise<void> {
	if (input.source !== undefined && !REGISTERING_SOURCES.has(input.source))
		return;
	if (input.scratchpad && (await isMarkedUnauthorized(input.scratchpad)))
		return;
	const destination = resolveDestination(deps);
	if (!destination) return;
	const vcs = await resolveVcs(input.cwd, deps.git);
	if (!vcs) return;
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
	await send(destination, registration, input.scratchpad, deps);
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
	await send(
		destination,
		{ ...saved, first_prompt_id: input.promptId },
		pad,
		deps,
	);
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
