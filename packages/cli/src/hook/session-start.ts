import { isAbsolute } from "node:path";
import {
	DESTINATION_MISMATCH_WARNING,
	INVALID_ENDPOINT_WARNING,
	keyMissingWarning,
	keyUnreadableWarning,
	notConfiguredWarning,
	REGISTRATION_FAILED_WARNING,
} from "@harnessforce/agent-core/hook-warning";
import {
	type Destination,
	postItem,
	type SendOutcome,
} from "@harnessforce/agent-core/ingest";
import { isIssueIdentifier } from "@harnessforce/agent-core/issue";
import { isObject } from "@harnessforce/agent-core/object";
import type { RunGit } from "@harnessforce/agent-core/process/git";
import { sessionContext } from "@harnessforce/agent-core/session-context";
import type { Env, Fetch } from "@harnessforce/agent-core/types";
import { resolveVcs } from "@harnessforce/agent-core/vcs";
import { isToken, type SessionRegistration } from "@harnessforce/semconv";
import type { Keychain } from "../credentials/keychain.js";
import {
	resolveUserDestination,
	type UserDestination,
} from "../credentials/user-destination.js";

export const HOOK_USAGE = "Usage: harnessforce hook session-start\n";

export type SessionStartDeps = {
	env: Env;
	homeDir: string;
	now: () => Date;
	git: RunGit;
	fetch: Fetch;
	keychain: Keychain;
	readStdin: (maxBytes: number) => Promise<Buffer>;
	stdout: (text: string) => void;
	stderr: (text: string) => void;
};

// Codexが渡す入力は小さなJSONのobjectである。
const MAX_INPUT_BYTES = 1024 * 1024;
// correlation.md「Codexのhook」: 登録を送るのはsourceが`startup`、`clear`、または無いときだけ。
const REGISTERING_SOURCES = new Set(["startup", "clear"]);
// correlation.md「Codex」: Codexのhookの上限時間は長く、ロックされたSecret Serviceの解錠の確認を待つと
// sessionの開始が止まるため、keychainの読み出しを打ち切り、keyが無いものとして扱う。
// 打ち切りは、keychainを読むuser settingsからの宛先の解決全体にかける。
const KEYCHAIN_READ_TIMEOUT_MS = 1_000;
const REVOKED_MESSAGE =
	"Your ingest key has been revoked. Run `harnessforce init`";

type Input = { sessionId: string; cwd: string; source: string | undefined };

function parseInput(raw: string): Input | undefined {
	let fields: unknown;
	try {
		fields = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!isObject(fields)) return undefined;
	const { session_id: sessionId, cwd, source } = fields;
	// 空のcwdで`git -C ""`を呼ぶと現在のdirectoryが対象になるため、絶対pathだけを受け付ける。
	if (
		typeof sessionId !== "string" ||
		!isToken(sessionId) ||
		typeof cwd !== "string" ||
		!isAbsolute(cwd)
	)
		return undefined;
	return {
		sessionId,
		cwd,
		source: typeof source === "string" ? source : undefined,
	};
}

const report = (deps: SessionStartDeps, detail: string) =>
	deps.stderr(`harnessforce: session registration ${detail}\n`);

// 送れない理由ごとのwarning（correlation.md「hookの警告」「送信の健全性」）。
type Resolved = { destination?: Destination; warning?: string };

const SKIPPED_WARNINGS: Record<
	Extract<UserDestination, { kind: "skipped" }>["reason"],
	string
> = {
	"not configured": notConfiguredWarning("codex"),
	"invalid endpoint": INVALID_ENDPOINT_WARNING,
	"no ingest key": keyMissingWarning("codex"),
	"keychain unreadable": keyUnreadableWarning("codex"),
	"destination not verified": DESTINATION_MISMATCH_WARNING.codex,
};

function resolveWithinLimit(deps: SessionStartDeps): Promise<UserDestination> {
	let timer: NodeJS.Timeout | undefined;
	const slow = new Promise<UserDestination>((resolve) => {
		timer = setTimeout(
			() => resolve({ kind: "skipped", reason: "keychain unreadable" }),
			KEYCHAIN_READ_TIMEOUT_MS,
		);
	});
	return Promise.race([
		resolveUserDestination({
			...deps,
			keychain: deps.keychain.withTimeout(KEYCHAIN_READ_TIMEOUT_MS),
		}).catch(
			(): UserDestination => ({
				kind: "skipped",
				reason: "keychain unreadable",
			}),
		),
		slow,
	]).finally(() => clearTimeout(timer));
}

async function resolveDestination(deps: SessionStartDeps): Promise<Resolved> {
	const resolved = await resolveWithinLimit(deps);
	if (resolved.kind === "ok") return { destination: resolved.destination };
	if (resolved.kind === "none") {
		report(deps, "skipped (not configured)");
		return { warning: notConfiguredWarning("codex") };
	}
	report(deps, `skipped (${resolved.reason})`);
	return { warning: SKIPPED_WARNINGS[resolved.reason] };
}

// Workspace用のkeyではないため、`HARNESSFORCE_ISSUE`が制約を満たせばsource=cliを名乗る。
function registrationSource(
	env: Env,
): Pick<SessionRegistration, "source" | "issue_identifier"> {
	const issue = env.HARNESSFORCE_ISSUE;
	return issue && isIssueIdentifier(issue)
		? { source: "cli", issue_identifier: issue }
		: { source: "hook" };
}

type Registered = { outcome?: SendOutcome; warning?: string };

async function register(
	input: Input,
	deps: SessionStartDeps,
): Promise<Registered> {
	const { destination, warning } = await resolveDestination(deps);
	if (!destination) return { warning };
	const vcs = await resolveVcs(input.cwd, deps.git);
	if (!vcs) return {};
	const registration: SessionRegistration = {
		agent: "codex",
		session_id: input.sessionId,
		...vcs,
		...registrationSource(deps.env),
		started_at: deps.now().toISOString(),
	};
	const outcome = await postItem(
		destination,
		"v1/sessions",
		registration,
		deps.fetch,
	);
	if (outcome.kind === "failed") report(deps, `failed (${outcome.reason})`);
	return { outcome };
}

// correlation.md「Codexのhook」。CodexのSessionStartのhookが起動する。どの失敗でもsessionを止めず、常にexit 0で終える。
export async function sessionStart(deps: SessionStartDeps): Promise<number> {
	const raw = await deps
		.readStdin(MAX_INPUT_BYTES)
		.then((buffer) => buffer.toString("utf8"))
		.catch(() => "");
	const input = parseInput(raw);
	if (!input) return 0;
	const registered =
		input.source === undefined || REGISTERING_SOURCES.has(input.source)
			? await register(input, deps).catch((error): Registered => {
					report(
						deps,
						`failed (${error instanceof Error ? error.name : "unknown"})`,
					);
					return {};
				})
			: {};
	const warning =
		registered.outcome?.kind === "unauthorized"
			? REVOKED_MESSAGE
			: (registered.warning ??
				(registered.outcome?.kind === "failed"
					? REGISTRATION_FAILED_WARNING
					: undefined));
	// CodexはSessionStartのJSONの`systemMessage`をUIの警告として示す（agent-telemetry.md「hook、MCP」）。
	if (warning !== undefined) deps.stderr(`${warning}\n`);
	deps.stdout(
		`${JSON.stringify({
			...sessionContext(input.sessionId),
			...(warning === undefined ? {} : { systemMessage: warning }),
		})}\n`,
	);
	return 0;
}
