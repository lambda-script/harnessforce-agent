import { isAbsolute, join } from "node:path";
import {
	type ClientIdentity,
	noticeLine,
	readSavedUpdateState,
	readUpdateState,
	recheckClientStatus,
	recordingFetch,
	unsupportedLine,
	updateLine,
} from "@harnessforce/agent-core/client-update";
import {
	COLLECT_BUDGET_MS,
	collectConfig,
} from "@harnessforce/agent-core/config/collect";
import type { ConfigComponent } from "@harnessforce/agent-core/config/component";
import {
	DESTINATION_MISMATCH_WARNING,
	INVALID_ENDPOINT_WARNING,
	keyMissingWarning,
	keyUnreadableWarning,
	notConfiguredWarning,
	REGISTRATION_FAILED_WARNING,
	TELEMETRY_NOT_CONFIGURED_WARNING,
} from "@harnessforce/agent-core/hook-warning";
import {
	type Destination,
	type IngestItem,
	type IngestPath,
	ingestBaseFrom,
	type KeyKind,
	postItems,
	type SendOutcome,
	workspaceIdOf,
} from "@harnessforce/agent-core/ingest";
import { isIssueIdentifier } from "@harnessforce/agent-core/issue";
import { readManagedEnv } from "@harnessforce/agent-core/managed";
import type { RunGit } from "@harnessforce/agent-core/process/git";
import { sessionContext } from "@harnessforce/agent-core/session-context";
import type { Env, Fetch } from "@harnessforce/agent-core/types";
import { resolveProjectRoot, resolveVcs } from "@harnessforce/agent-core/vcs";
import {
	claudeLocationStatePath,
	type LocationEvent,
	observedDirectories,
	recordObservedPairs,
	sendLocations,
} from "@harnessforce/agent-core/work-location";
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
import { COUNTING_EVENTS, countedOf } from "./usage/count.js";
import { sendSessionUsage, sendUnsentUsage } from "./usage/send.js";
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
	// `harnessforce otel-headers`を起動してkeychainの利用者用IngestKeyを読む。
	readUserKey: (cwd: string) => Promise<UserKeyRead>;
	// `harnessforce init`が書いたClaude Codeのテレメトリの設定があるか（correlation.md「送信の健全性」）。
	isTelemetryConfigured: () => Promise<boolean>;
	// このpluginの版。Harnessforceへの要求の`User-Agent`に載せる（client-updates.md「版の申告」）。
	client: ClientIdentity;
	// Claude Codeがpluginを自動更新するとみなせるか。sessionのcwdのrepositoryの設定も見る。
	isPluginAutoUpdateEffective: (cwd: string) => Promise<boolean>;
};

// runHookが、要求に版を申告するfetchへ差し替えた依存。baseFetchは差し替える前のfetchとする。
type Deps = HookDeps & { baseFetch: Fetch };

// client-updates.md「状態の保存」: pluginの更新をまたいで残るdata directoryに置く。
const pluginStatePath = (env: Env) =>
	env.CLAUDE_PLUGIN_DATA && isAbsolute(env.CLAUDE_PLUGIN_DATA)
		? join(env.CLAUDE_PLUGIN_DATA, "update-status.json")
		: undefined;
// CLIが自身の状態を置くfile。`harnessforce otel-headers`が終了コード5で終わったときに確かめ直す。
const cliStatePath = (homeDir: string) =>
	join(homeDir, ".harnessforce", "update-status.json");
const CLI_UNSUPPORTED_WARNING = unsupportedLine("cli");

// correlation.md「hook」の共通の規則が、選んだkeyの種類ごとに定める文言。
const REVOKED_KEY_MESSAGES: Record<KeyKind, string> = {
	user: "Your ingest key has been revoked. Run `harnessforce init`",
	workspace:
		"The organization's ingest key has been revoked. Contact a Workspace administrator",
};

// resumeとcompactは同じsessionの継続なので送らない。未知のsourceも送らない。
const REGISTERING_SOURCES = new Set(["startup", "clear", "fork"]);

const logError = (deps: Deps) => (error: unknown) =>
	deps.stderr(
		`harnessforce: ${error instanceof Error ? error.message : String(error)}\n`,
	);

type Subject = "session registration" | "config snapshot" | "session usage";
const report = (deps: Deps, subject: Subject, detail: string) =>
	deps.stderr(`harnessforce: ${subject} ${detail}\n`);

// keyを得られなかった理由ごとの警告（correlation.md「送信の健全性」）。harnessforceを起動しなかった場合は示さない。
const KEY_WARNINGS: Partial<Record<UserKeyRead["kind"], string>> = {
	absent: keyMissingWarning("claude_code"),
	withheld: DESTINATION_MISMATCH_WARNING.claude_code,
	unreadable: keyUnreadableWarning("claude_code"),
};

// 利用者用のkeyは、`harnessforce otel-headers`が送信先の固定を確かめたうえで返す。
async function selectUserKey(
	deps: Deps,
	cwd: string,
): Promise<{ key?: string; warning?: string; isCliUnsupported?: boolean }> {
	if (!deps.env.HARNESSFORCE_WORKSPACE_ID) return {};
	const read = await deps.readUserKey(cwd);
	if (read.kind === "found") return { key: read.key };
	if (read.kind !== "missing")
		deps.stderr("harnessforce: no user key in keychain or read failed\n");
	return {
		warning: KEY_WARNINGS[read.kind],
		isCliUnsupported: read.kind === "cliUnsupported",
	};
}

// 表示する1行と、その順位を決める種類（correlation.md「hookの警告」）。sendingは送信の設定と失敗の警告。
type Notice = {
	kind: "revoked" | "clientUnsupported" | "sending";
	message: string;
};

// 送れない理由が利用者の設定にあるときだけwarningを返す（correlation.md「hookの警告」）。
type Resolved = { destination?: Destination; warning?: Notice };

const sendingNotice = (message: string | undefined): Notice | undefined =>
	message === undefined ? undefined : { kind: "sending", message };

// Workspace用のkeyとその送信先はmanaged settingsのfileからだけ読む。processの環境変数はrepositoryのsettingsが書けるためである。
// Workspace用のkeyが無ければ、processの環境変数の送信先と利用者用のkeyを使う。
// 送信先の判定をkeyの判定より先に行い、両方が無ければ送信先の終端だけを書く。警告は、未設定を送信先の不正より先に判定する。
// withUserKeyが偽なら、Workspace用のkeyが無いときは何も書かずに送らない。
async function resolveDestination(
	deps: Deps,
	cwd: string,
	withUserKey = true,
): Promise<Resolved> {
	const managed = await readManagedEnv(deps.managedDir, [
		"HARNESSFORCE_INGEST_KEY",
		"HARNESSFORCE_ENDPOINT",
	]);
	const workspaceKey = managed.HARNESSFORCE_INGEST_KEY;
	if (!workspaceKey && !withUserKey) return {};
	const endpoint = workspaceKey
		? managed.HARNESSFORCE_ENDPOINT
		: deps.env.HARNESSFORCE_ENDPOINT;
	const notConfigured =
		!endpoint || !(workspaceKey || deps.env.HARNESSFORCE_WORKSPACE_ID);
	const ingestBase = ingestBaseFrom(endpoint);
	if (!ingestBase) {
		report(deps, "session registration", "skipped (invalid endpoint)");
		return {
			warning: sendingNotice(
				notConfigured
					? notConfiguredWarning("claude_code")
					: INVALID_ENDPOINT_WARNING,
			),
		};
	}
	if (workspaceKey)
		return {
			destination: { ingestBase, key: workspaceKey, keyKind: "workspace" },
		};
	const {
		key: userKey,
		warning,
		isCliUnsupported,
	} = await selectUserKey(deps, cwd);
	if (!userKey) {
		report(deps, "session registration", "skipped (no ingest key)");
		// clientの版が対応外の警告は、送信の設定の警告より先に示す（correlation.md「hookの警告」）。
		if (isCliUnsupported) {
			await recheckCliStatus(deps, ingestBase);
			return {
				warning: {
					kind: "clientUnsupported",
					message: CLI_UNSUPPORTED_WARNING,
				},
			};
		}
		return {
			warning: sendingNotice(
				notConfigured ? notConfiguredWarning("claude_code") : warning,
			),
		};
	}
	return { destination: { ingestBase, key: userKey, keyKind: "user" } };
}

// CLIの状態のfileを、そのCLIの版で確かめ直す。CLIのcommandを実行しない利用者でも、最小対応版の誤りを直した後に戻るためである。
async function recheckCliStatus(deps: Deps, ingestBase: URL): Promise<void> {
	const statePath = cliStatePath(deps.homeDir);
	// CLIの版はpluginに分からないため、状態のfileが持つ版をそのまま使う。
	const state = await readSavedUpdateState(statePath);
	if (!state) return;
	const cli: ClientIdentity = {
		component: "cli",
		version: state.version,
		dev: false,
	};
	await recheckClientStatus({
		state,
		ingestBase,
		fetch: recordingFetch(deps.baseFetch, cli, statePath, deps.now),
		statePath,
		version: state.version,
		now: deps.now,
	});
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
	deps: Deps,
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
	deps: Deps,
): Promise<string> {
	const message = REVOKED_KEY_MESSAGES[destination.keyKind];
	deps.stderr(`${message}\n`);
	if (pad) await markUnauthorized(pad).catch(logError(deps));
	return message;
}

// stdoutはJSONのobject1つだけとする（correlation.md「hook」）。JSONの出力はstdoutがそのobjectだけのときに解釈される。
const writeJson = (deps: Deps, output: object) =>
	deps.stdout(`${JSON.stringify(output)}\n`);

async function registerSession(
	input: HookInput,
	destination: Destination,
	deps: Deps,
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
	deps: Deps,
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
	deps: Deps,
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
async function appendIfRecording(
	usage: UsageStore,
	line: RecordLine,
): Promise<void> {
	if (await readState(usage)) await appendRecord(usage, line);
}

const promptIdOf = (input: HookInput) =>
	input.promptId === undefined ? {} : { promptId: input.promptId };

// SessionStartの利用の要約: このsessionの状態のfileを作り、他のsessionの送れていない要約を送る。
// 401は登録とsnapshotの401と同じく扱うため、送信の結果を返す。それ以外の失敗は次のsessionの開始で送り直す。
async function startUsage(
	usage: UsageStore,
	destination: Destination,
	collected: Promise<ConfigComponent[] | undefined>,
	deps: Deps,
): Promise<SendOutcome | undefined> {
	const [, unsent] = await Promise.all([
		collected
			.then((components) =>
				createUsageState(usage, destination, components ?? []),
			)
			.catch(logError(deps)),
		sendUnsentUsage(usage, destination, deps).catch(logError(deps)),
	]);
	if (unsent?.kind === "failed")
		report(deps, "session usage", `failed (${unsent.reason})`);
	return unsent ?? undefined;
}

// 利用者へ表示する1行。401のkeyの文言を、送信の失敗と設定の警告より優先する。
async function sendSessionStart(
	input: HookInput,
	usage: UsageStore | undefined,
	deps: Deps,
): Promise<Notice | undefined> {
	const registers =
		input.source === undefined || REGISTERING_SOURCES.has(input.source);
	if (!registers && !usage) return undefined;
	if (input.scratchpad && (await isMarkedUnauthorized(input.scratchpad)))
		return undefined;
	const { destination, warning } = await resolveDestination(deps, input.cwd);
	// 警告は登録を送るsourceだけに出す（correlation.md「hookの警告」）。
	if (!destination) return registers ? warning : undefined;
	// resumeとcompactはsnapshotを送らないが、状態のfileを作るなら識別子のために構成を集める。
	const collects = registers || (usage && !(await readState(usage)));
	const collected = collects
		? collectComponents(input, deps)
		: Promise.resolve(undefined);
	// Workspace用のkeyを配る組織は、テレメトリの設定をhookが読めない経路で配りうるため判定しない。
	const isConfigured =
		registers && destination.keyKind === "user"
			? deps.isTelemetryConfigured()
			: Promise.resolve(true);
	const [registration, snapshot, unsent, configured] = await Promise.all([
		registers
			? registerSession(input, destination, deps).catch(logError(deps))
			: undefined,
		registers
			? collected
					.then((components) =>
						components
							? sendConfigSnapshot(input, components, destination, deps)
							: undefined,
					)
					.catch(logError(deps))
			: undefined,
		usage ? startUsage(usage, destination, collected, deps) : undefined,
		isConfigured,
	]);
	if (
		[registration, snapshot, unsent].some(
			(outcome) => outcome?.kind === "unauthorized",
		)
	)
		return {
			kind: "revoked",
			message: await reportRevokedKey(destination, input.scratchpad, deps),
		};
	if (!configured) return sendingNotice(TELEMETRY_NOT_CONFIGURED_WARNING);
	return sendingNotice(
		registration?.kind === "failed" ? REGISTRATION_FAILED_WARNING : undefined,
	);
}

// 送信先の判定と同じく、Workspace用のkeyがあればmanaged settingsの送信先、無ければprocessの環境変数の送信先へ確かめる。
async function statusCheckBase(deps: Deps): Promise<URL | undefined> {
	const managed = await readManagedEnv(deps.managedDir, [
		"HARNESSFORCE_INGEST_KEY",
		"HARNESSFORCE_ENDPOINT",
	]);
	return ingestBaseFrom(
		managed.HARNESSFORCE_INGEST_KEY
			? managed.HARNESSFORCE_ENDPOINT
			: deps.env.HARNESSFORCE_ENDPOINT,
	);
}

/**
 * pluginの状態のfileがunsupportedなら送信を止める（client-updates.md「送信の停止」）。recheckなら、受けてから24時間以上
 * 経った状態を資格情報を送らずに確かめ直す。SessionEndは1秒の予算に収めるため確かめ直さない。
 */
async function isPluginBlocked(deps: Deps, recheck: boolean): Promise<boolean> {
	const statePath = pluginStatePath(deps.env);
	if (!statePath) return false;
	const state = await readUpdateState(statePath, deps.client.version);
	if (state?.status !== "unsupported") return false;
	const ingestBase = recheck ? await statusCheckBase(deps) : undefined;
	const checked = ingestBase
		? await recheckClientStatus({
				state,
				ingestBase,
				fetch: deps.fetch,
				statePath,
				version: deps.client.version,
				now: deps.now,
			})
		: state;
	return checked?.status === "unsupported";
}

// correlation.md「hookの警告」の順: 401、clientの版が対応外、送信の設定と失敗の警告、clientの更新の期限、新しい版がある。
async function withUpdateLine(
	notice: Notice | undefined,
	input: HookInput,
	deps: Deps,
): Promise<string | undefined> {
	if (notice && notice.kind !== "sending") return notice.message;
	const statePath = pluginStatePath(deps.env);
	const state = statePath
		? await readUpdateState(statePath, deps.client.version)
		: undefined;
	if (state?.status === "unsupported")
		return updateLine("claude-code-plugin", state);
	if (notice || !state || !statePath) return notice?.message;
	// Claude Codeが次のsessionまでに更新する間は、新しい版を示さない。
	return noticeLine("claude-code-plugin", statePath, state, {
		now: deps.now(),
		env: deps.env,
		isSuppressed: () => deps.isPluginAutoUpdateEffective(input.cwd),
	});
}

// sourceや送信の結果によらず、session contextを必ず1回出す。resumeとcompactの後のcontextにもsession IDを残すためである。
async function onSessionStart(input: HookInput, deps: Deps): Promise<void> {
	const usage = usageStoreOf(input.sessionId, deps.env);
	const startedAt = deps.now();
	if (usage) await removeExpiredFiles(usage, startedAt).catch(logError(deps));
	const registers =
		input.source === undefined || REGISTERING_SOURCES.has(input.source);
	const blocked = await isPluginBlocked(deps, true).catch(() => false);
	const sent = blocked
		? undefined
		: await sendSessionStart(input, usage, deps).catch((error) => {
				logError(deps)(error);
				return undefined;
			});
	// 表示は登録を送るsourceだけとする（correlation.md「hookの警告」）。
	const message = registers
		? await withUpdateLine(sent, input, deps).catch(() => sent?.message)
		: sent?.message;
	if (usage)
		await appendIfRecording(usage, {
			at: startedAt.toISOString(),
			kind: "start",
			...promptIdOf(input),
		}).catch(logError(deps));
	writeJson(deps, {
		...sessionContext(input.sessionId),
		...(message === undefined ? {} : { systemMessage: message }),
	});
}

// sessionの最初のpromptだけ、SessionStartが保存した登録にprompt_idを加えて送る。SessionStartの送信の再送を兼ねる。
async function onUserPromptSubmit(input: HookInput, deps: Deps): Promise<void> {
	const usage = usageStoreOf(input.sessionId, deps.env);
	if (usage)
		await appendIfRecording(usage, {
			at: deps.now().toISOString(),
			kind: "prompt",
			...promptIdOf(input),
		}).catch(logError(deps));
	const pad = input.scratchpad;
	if (!input.promptId || !pad || (await isMarkedUnauthorized(pad))) return;
	if (await isPluginBlocked(deps, false)) return;
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

// correlation.md「送る契機」: SessionEndのhook全体の1.5秒の予算のうち、processの開始から使う時間。残りは余裕とする。
const SESSION_END_BUDGET_MS = 1000;

// SessionEndは`harnessforce otel-headers`を起動せず、Workspace用のkeyを選ぶ場合だけ送る。JSONの出力は捨てられるためstdoutへ書かない。
async function onSessionEnd(input: HookInput, deps: Deps): Promise<void> {
	const usage = usageStoreOf(input.sessionId, deps.env);
	if (!usage) return;
	if (input.scratchpad && (await isMarkedUnauthorized(input.scratchpad)))
		return;
	if (await isPluginBlocked(deps, false)) return;
	const { destination } = await resolveDestination(deps, input.cwd, false);
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
	async (input: HookInput, deps: Deps): Promise<void> => {
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

const locationStatePathOf = (input: HookInput) =>
	input.scratchpad
		? claudeLocationStatePath(input.scratchpad.dir, input.sessionId)
		: undefined;

/**
 * correlation.md「sessionの作業位置」: 観測した時点のworking treeのrepositoryとbranchを記録する。`Stop`は加えて、記録した組の
 * 集合が最後に送った集合と異なれば送る。stdoutへ何も書かず、`CwdChanged`ではstderrにも書かない。
 */
const onLocationEvent =
	(event: LocationEvent) =>
	async (input: HookInput, deps: Deps): Promise<void> => {
		const statePath = locationStatePathOf(input);
		if (!statePath) return;
		const directories = observedDirectories(
			"claude_code",
			event,
			input.fields,
			input.cwd,
		);
		const state = await recordObservedPairs(statePath, directories, deps);
		if (event !== "stop" || !input.scratchpad) return;
		if (await isMarkedUnauthorized(input.scratchpad)) return;
		if (await isPluginBlocked(deps, false)) return;
		const { destination } = await resolveDestination(deps, input.cwd);
		if (!destination) return;
		const sent = await sendLocations(
			statePath,
			state,
			{ agent: "claude_code", sessionId: input.sessionId },
			destination,
			deps.fetch,
		);
		if (sent.kind !== "sent" || sent.outcome.kind === "accepted") return;
		if (sent.outcome.kind === "unauthorized") {
			await markUnauthorized(input.scratchpad).catch(logError(deps));
			deps.stderr("harnessforce: session location failed (unauthorized)\n");
			return;
		}
		deps.stderr(
			`harnessforce: session location failed (${sent.outcome.reason})\n`,
		);
	};

// CwdChangedのstderrは利用者に示される（claude-code.md「作業位置に使うhook」）ため、失敗も書かない。
const silently =
	(handler: Handler): Handler =>
	(input, deps) =>
		handler(input, { ...deps, stderr: () => {} }).catch(() => {});

type Handler = (input: HookInput, deps: Deps) => Promise<void>;
const HANDLERS = new Map<string, Handler>([
	["session-start", onSessionStart],
	["user-prompt-submit", onUserPromptSubmit],
	["session-end", onSessionEnd],
	["cwd-changed", silently(onLocationEvent("cwd-changed"))],
	["work-location", onLocationEvent("post-tool-use")],
	["stop", onLocationEvent("stop")],
	...COUNTING_EVENTS.map(
		(event) => [event, onCountingEvent(event)] as [string, Handler],
	),
]);

export async function runHook(
	event: string,
	rawInput: string,
	hookDeps: HookDeps,
): Promise<void> {
	const handler = HANDLERS.get(event);
	const input = parseHookInput(rawInput);
	if (!handler || !input) return;
	// Harnessforceへの要求に版を申告し、応答の更新の状態を保存する（client-updates.md「版の申告」）。
	const deps: Deps = {
		...hookDeps,
		baseFetch: hookDeps.fetch,
		fetch: recordingFetch(
			hookDeps.fetch,
			hookDeps.client,
			pluginStatePath(hookDeps.env),
			hookDeps.now,
		),
	};
	// fail-open: どの失敗でもsessionを止めない。stderrはdebug logにだけ出る。
	await handler(input, deps).catch(logError(deps));
}
