import {
	COLLECT_BUDGET_MS,
	collectConfig,
} from "@harnessforce/agent-core/config/collect";
import type { ConfigComponent } from "@harnessforce/agent-core/config/component";
import { isIssueIdentifier } from "@harnessforce/agent-core/issue";
import { readManagedEnv } from "@harnessforce/agent-core/managed";
import type { RunGit } from "@harnessforce/agent-core/process/git";
import type { Env, Fetch } from "@harnessforce/agent-core/types";
import { resolveProjectRoot, resolveVcs } from "@harnessforce/agent-core/vcs";
import type {
	ConfigSnapshot,
	SessionRegistration,
} from "@harnessforce/semconv";
import {
	type Destination,
	type IngestItem,
	type IngestPath,
	ingestBaseFrom,
	type KeyKind,
	postItems,
	type SendOutcome,
	workspaceIdOf,
} from "./destination.js";
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
import { COUNTING_EVENTS, countedOf } from "./usage/count.js";
import { sendPendingUsage, sendSessionUsage } from "./usage/send.js";
import {
	appendRecord,
	createState,
	identifiersOf,
	type RecordLine,
	readState,
	removeExpiredFiles,
	type UsageStore,
	usageStoreOf,
} from "./usage/store.js";
import type { UserKeyRead } from "./user-key.js";

export type HookDeps = {
	env: Env;
	now: () => Date;
	// hookのprocessが始まった時刻（ms）。SessionEndの送信の予算はここから数える。
	processStartMs: number;
	git: RunGit;
	fetch: Fetch;
	stdout: (text: string) => void;
	stderr: (text: string) => void;
	homeDir: string;
	managedDir: string;
	// `hf otel-headers`を起動してkeychainの利用者用IngestKeyを読む。
	readUserKey: (cwd: string) => Promise<UserKeyRead>;
};

// correlation.md「hook」の共通の規則が、選んだkeyの種類ごとに定める文言。
const REVOKED_KEY_MESSAGES: Record<KeyKind, string> = {
	user: "送信キーが失効しています。`hf init`を実行してください",
	workspace:
		"組織の送信キーが失効しています。Workspaceの管理者に連絡してください",
};

// resumeとcompactは同じsessionの継続なので送らない。未知のsourceも送らない。
const REGISTERING_SOURCES = new Set(["startup", "clear", "fork"]);

const logError = (deps: HookDeps) => (error: unknown) =>
	deps.stderr(
		`harnessforce: ${error instanceof Error ? error.message : String(error)}\n`,
	);

type Subject = "session registration" | "config snapshot" | "session usage";
const report = (deps: HookDeps, subject: Subject, detail: string) =>
	deps.stderr(`harnessforce: ${subject} ${detail}\n`);

// 利用者用のkeyは、`hf otel-headers`が送信先の固定を確かめたうえで返す。
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

// Workspace用のkeyとその送信先はmanaged settingsのfileからだけ読む。processの環境変数はrepositoryのsettingsが書けるためである。
// Workspace用のkeyが無ければ、processの環境変数の送信先と利用者用のkeyを使う。
// 送信先の判定をkeyの判定より先に行い、両方が無ければ送信先の終端だけを書く。
// withUserKeyが偽なら、Workspace用のkeyが無いときは何も書かずに送らない。
async function resolveDestination(
	deps: HookDeps,
	cwd: string,
	withUserKey = true,
): Promise<Destination | undefined> {
	const managed = await readManagedEnv(deps.managedDir, [
		"HARNESSFORCE_INGEST_KEY",
		"HARNESSFORCE_ENDPOINT",
	]);
	const workspaceKey = managed.HARNESSFORCE_INGEST_KEY;
	if (!workspaceKey && !withUserKey) return undefined;
	const ingestBase = ingestBaseFrom(
		workspaceKey
			? managed.HARNESSFORCE_ENDPOINT
			: deps.env.HARNESSFORCE_ENDPOINT,
	);
	if (!ingestBase) {
		report(deps, "session registration", "skipped (invalid endpoint)");
		return undefined;
	}
	if (workspaceKey)
		return { ingestBase, key: workspaceKey, keyKind: "workspace" };
	const userKey = await selectUserKey(deps, cwd);
	if (!userKey) {
		report(deps, "session registration", "skipped (no ingest key)");
		return undefined;
	}
	return { ingestBase, key: userKey, keyKind: "user" };
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
	const outcome = await postItems(destination, path, [item], deps.fetch);
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

// correlation.md「session context」: skillがstart_runへ渡すsession IDを、session registrationと同じ値でcontextへ加える。
const sessionContext = (sessionId: string) => ({
	hookSpecificOutput: {
		hookEventName: "SessionStart",
		additionalContext: `harnessforce session_id: ${sessionId}`,
	},
});

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

// 打ち切った場合と失敗した場合はundefinedを返す。
async function collectComponents(
	input: HookInput,
	deps: HookDeps,
): Promise<ConfigComponent[] | undefined> {
	// 収集の開始はproject rootを求める前とする（correlation.md「構成の収集」）。
	const startedMs = deps.now().getTime();
	try {
		const projectRoot = await resolveProjectRoot(input.cwd, deps.git);
		const result = await collectConfig({
			projectRoot,
			homeDir: deps.homeDir,
			managedDir: deps.managedDir,
			env: deps.env,
			isExpired: () => deps.now().getTime() - startedMs > COLLECT_BUDGET_MS,
		});
		if (result.kind === "collected") return result.components;
		report(deps, "config snapshot", `skipped (${result.reason})`);
	} catch (error) {
		logError(deps)(error);
	}
	return undefined;
}

// gitのrepositoryの外でも送る。componentsが0件なら送らない。
async function sendConfigSnapshot(
	input: HookInput,
	components: ConfigComponent[],
	destination: Destination,
	deps: HookDeps,
): Promise<SendOutcome | undefined> {
	if (components.length === 0) return undefined;
	const snapshot: ConfigSnapshot = {
		agent: "claude_code",
		session_id: input.sessionId,
		components,
	};
	return send(
		destination,
		"v1/config-snapshots",
		snapshot,
		"config snapshot",
		deps,
	);
}

// correlation.md「状態のfileの作成」: 送信先のWorkspaceのidと、sessionのconfig snapshotの識別子を持つ。
async function createUsageState(
	usage: UsageStore,
	destination: Destination,
	components: readonly ConfigComponent[],
): Promise<void> {
	const workspaceId = workspaceIdOf(destination.key);
	if (workspaceId === undefined) return;
	await createState(usage, {
		workspaceId,
		identifiers: identifiersOf(components),
		sentLength: 0,
	});
}

// 状態のfileが無いsessionでは記録しない。
async function record(usage: UsageStore, line: RecordLine): Promise<void> {
	if (await readState(usage)) await appendRecord(usage, line);
}

const promptIdOf = (input: HookInput) =>
	input.promptId === undefined ? {} : { promptId: input.promptId };

// 401は登録とsnapshotの401と同じく扱う。それ以外の失敗では書かず、次のsessionの開始で送り直す。
async function sendUnsentUsage(
	usage: UsageStore,
	destination: Destination,
	deps: HookDeps,
): Promise<SendOutcome | undefined> {
	const outcome = await sendPendingUsage(usage, destination, deps);
	if (outcome?.kind === "failed")
		report(deps, "session usage", `failed (${outcome.reason})`);
	return outcome;
}

type RevokedKeyMessage = string;

// 401を受けたら、失効したkeyの文言を返す。
async function sendSessionStart(
	input: HookInput,
	usage: UsageStore | undefined,
	deps: HookDeps,
): Promise<RevokedKeyMessage | undefined> {
	const registers =
		input.source === undefined || REGISTERING_SOURCES.has(input.source);
	if (!registers && !usage) return undefined;
	if (input.scratchpad && (await isMarkedUnauthorized(input.scratchpad)))
		return undefined;
	const destination = await resolveDestination(deps, input.cwd);
	if (!destination) return undefined;
	// resumeとcompactは構成を集めないため、状態のfileを作るなら識別子は空になる。
	const collected = registers
		? collectComponents(input, deps)
		: Promise.resolve(undefined);
	const outcomes = await Promise.all([
		registers
			? registerSession(input, destination, deps).catch(logError(deps))
			: undefined,
		collected
			.then((components) =>
				components
					? sendConfigSnapshot(input, components, destination, deps)
					: undefined,
			)
			.catch(logError(deps)),
		usage &&
			collected
				.then((components) =>
					createUsageState(usage, destination, components ?? []),
				)
				.catch(logError(deps)),
		usage && sendUnsentUsage(usage, destination, deps).catch(logError(deps)),
	]);
	if (!outcomes.some((outcome) => outcome?.kind === "unauthorized"))
		return undefined;
	return reportRevokedKey(destination, input.scratchpad, deps);
}

// sourceや送信の結果によらず、session contextを必ず1回出す。resumeとcompactの後のcontextにもsession IDを残すためである。
async function onSessionStart(input: HookInput, deps: HookDeps): Promise<void> {
	const usage = usageStoreOf(input.sessionId, deps.env);
	const startedAt = deps.now();
	if (usage) await removeExpiredFiles(usage, startedAt).catch(logError(deps));
	const revoked = await sendSessionStart(input, usage, deps).catch((error) => {
		logError(deps)(error);
		return undefined;
	});
	if (usage)
		await record(usage, {
			at: startedAt.toISOString(),
			kind: "start",
			...promptIdOf(input),
		}).catch(logError(deps));
	writeJson(deps, {
		...sessionContext(input.sessionId),
		...(revoked === undefined ? {} : { systemMessage: revoked }),
	});
}

// sessionの最初のpromptだけ、SessionStartが保存した登録にprompt_idを加えて送る。SessionStartの送信の再送を兼ねる。
async function onUserPromptSubmit(
	input: HookInput,
	deps: HookDeps,
): Promise<void> {
	const usage = usageStoreOf(input.sessionId, deps.env);
	if (usage)
		await record(usage, {
			at: deps.now().toISOString(),
			kind: "prompt",
			...promptIdOf(input),
		}).catch(logError(deps));
	const pad = input.scratchpad;
	if (!input.promptId || !pad || (await isMarkedUnauthorized(pad))) return;
	const saved = await loadRegistration(pad);
	if (!saved || (await isFirstPromptSent(pad))) return;
	const destination = await resolveDestination(deps, input.cwd);
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

// correlation.md「送る契機」: SessionEndのhook全体の1.5秒の予算のうち、processの開始から使う時間。残りは余裕とする。
const SESSION_END_BUDGET_MS = 1000;

// SessionEndは`hf otel-headers`を起動せず、Workspace用のkeyを選ぶ場合だけ送る。JSONの出力は捨てられるためstdoutへ書かない。
async function onSessionEnd(input: HookInput, deps: HookDeps): Promise<void> {
	const usage = usageStoreOf(input.sessionId, deps.env);
	if (!usage) return;
	if (input.scratchpad && (await isMarkedUnauthorized(input.scratchpad)))
		return;
	const destination = await resolveDestination(deps, input.cwd, false);
	if (!destination) return;
	const outcome = await sendSessionUsage(
		usage,
		destination,
		deps.processStartMs + SESSION_END_BUDGET_MS,
		deps,
	);
	if (outcome && outcome.kind !== "accepted")
		report(
			deps,
			"session usage",
			`failed (${outcome.kind === "failed" ? outcome.reason : "HTTP 401"})`,
		);
}

// correlation.md「数えるhook」: 状態のfileの識別子で名前を対応させ、1回を1行として記録する。stdoutへ何も書かない。
const onCountingEvent =
	(event: (typeof COUNTING_EVENTS)[number]) =>
	async (input: HookInput, deps: HookDeps): Promise<void> => {
		const usage = usageStoreOf(input.sessionId, deps.env);
		const state = usage && (await readState(usage));
		const counted = state && countedOf(event, input.fields, state.identifiers);
		if (usage && counted)
			await appendRecord(usage, {
				at: deps.now().toISOString(),
				...promptIdOf(input),
				...counted,
			});
	};

type Handler = (input: HookInput, deps: HookDeps) => Promise<void>;
const HANDLERS = new Map<string, Handler>([
	["session-start", onSessionStart],
	["user-prompt-submit", onUserPromptSubmit],
	["session-end", onSessionEnd],
	...COUNTING_EVENTS.map(
		(event) => [event, onCountingEvent(event)] as [string, Handler],
	),
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
