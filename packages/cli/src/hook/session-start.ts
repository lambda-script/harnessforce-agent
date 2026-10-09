import { isAbsolute } from "node:path";
import {
	type Destination,
	postItem,
	type SendOutcome,
} from "@harnessforce/agent-core/ingest";
import { isIssueIdentifier } from "@harnessforce/agent-core/issue";
import { isObject } from "@harnessforce/agent-core/object";
import type { RunGit } from "@harnessforce/agent-core/process/git";
import {
	sessionContext,
	sessionContextLine,
} from "@harnessforce/agent-core/session-context";
import type { Env, Fetch } from "@harnessforce/agent-core/types";
import { resolveVcs } from "@harnessforce/agent-core/vcs";
import { isToken, type SessionRegistration } from "@harnessforce/semconv";
import type { Keychain } from "../credentials/keychain.js";
import { resolveUserDestination } from "../credentials/user-destination.js";

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
const REVOKED_MESSAGE =
	"送信キーが失効しています。`harnessforce init`を実行してください";

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

async function resolveDestination(
	deps: SessionStartDeps,
): Promise<Destination | undefined> {
	const resolved = await resolveUserDestination(deps);
	// Claude Codeを設定していない端末では、毎回の stderr を避けるため、何も言わずに送らない。
	if (resolved.kind === "none") return undefined;
	if (resolved.kind === "skipped") {
		report(deps, `skipped (${resolved.reason})`);
		return undefined;
	}
	return resolved.destination;
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

async function register(
	input: Input,
	deps: SessionStartDeps,
): Promise<SendOutcome | undefined> {
	const destination = await resolveDestination(deps);
	if (!destination) return undefined;
	const vcs = await resolveVcs(input.cwd, deps.git);
	if (!vcs) return undefined;
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
	return outcome;
}

// correlation.md「Codexのhook」。CodexのSessionStartのhookが起動する。どの失敗でもsessionを止めず、常にexit 0で終える。
export async function sessionStart(deps: SessionStartDeps): Promise<number> {
	const raw = await deps
		.readStdin(MAX_INPUT_BYTES)
		.then((buffer) => buffer.toString("utf8"))
		.catch(() => "");
	const input = parseInput(raw);
	if (!input) return 0;
	const outcome =
		input.source === undefined || REGISTERING_SOURCES.has(input.source)
			? await register(input, deps).catch((error) => {
					report(
						deps,
						`failed (${error instanceof Error ? error.name : "unknown"})`,
					);
					return undefined;
				})
			: undefined;
	if (outcome?.kind === "unauthorized") {
		// `additionalContext`以外の項目をCodexが受け付けるか確認できていないため、JSONにせず平文で出す。
		// SessionStartの平文のstdoutはそのままagentのcontextに加えられ、利用者とagentに届く。
		deps.stderr(`${REVOKED_MESSAGE}\n`);
		deps.stdout(`${sessionContextLine(input.sessionId)}\n${REVOKED_MESSAGE}\n`);
		return 0;
	}
	deps.stdout(`${JSON.stringify(sessionContext(input.sessionId))}\n`);
	return 0;
}
