import { isAbsolute } from "node:path";
import { isObject } from "@harnessforce/agent-core/object";
import {
	codexLocationStatePath,
	type LocationEvent,
	observedDirectories,
	recordObservedPairs,
	sendLocations,
} from "@harnessforce/agent-core/work-location";
import { isToken } from "@harnessforce/semconv";
import { isSendingBlocked } from "../client-update.js";
import {
	MAX_INPUT_BYTES,
	resolveDestination,
	type SessionStartDeps,
} from "./session-start.js";

export type WorkLocationDeps = SessionStartDeps & {
	// OSの一時directory。Codexのhookは`scratchpad_dir`を受け取らないため、作業位置の記録をここに置く。
	hookTmpDir: string;
};

type Input = {
	sessionId: string;
	cwd: string;
	fields: Record<string, unknown>;
};

function parseInput(raw: string): Input | undefined {
	let fields: unknown;
	try {
		fields = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!isObject(fields)) return undefined;
	const { session_id: sessionId, cwd } = fields;
	// 空のcwdで`git -C ""`を呼ぶと現在のdirectoryが対象になるため、絶対pathだけを受け付ける。
	if (
		typeof sessionId !== "string" ||
		!isToken(sessionId) ||
		typeof cwd !== "string" ||
		!isAbsolute(cwd)
	)
		return undefined;
	return { sessionId, cwd, fields };
}

const report = (deps: WorkLocationDeps, detail: string) =>
	deps.stderr(`harnessforce: session location ${detail}\n`);

async function observe(
	event: LocationEvent,
	input: Input,
	deps: WorkLocationDeps,
): Promise<void> {
	const statePath = await codexLocationStatePath(
		deps.hookTmpDir,
		input.sessionId,
	);
	if (!statePath) return;
	const directories = observedDirectories(
		"codex",
		event,
		input.fields,
		input.cwd,
	);
	const state = await recordObservedPairs(statePath, directories, deps);
	if (event !== "stop") return;
	if (state.unauthorized) return;
	if (await isSendingBlocked(deps)) return;
	// 送信先が無い理由は、SessionStartのhookが警告する。
	const { destination } = await resolveDestination({
		...deps,
		stderr: () => {},
	});
	if (!destination) return;
	const sent = await sendLocations(
		statePath,
		state,
		{ agent: "codex", sessionId: input.sessionId },
		destination,
		deps.fetch,
	);
	if (sent.kind !== "sent" || sent.outcome.kind === "accepted") return;
	report(
		deps,
		`failed (${sent.outcome.kind === "unauthorized" ? "unauthorized" : sent.outcome.reason})`,
	);
}

/**
 * correlation.md「Codexのhook」「sessionの作業位置」。Codexの`PostToolUse`と`Stop`のhookが起動する。どの失敗でもsessionを
 * 止めず、常にexit 0で終える。`Stop`はstdoutにJSONを期待するため、空のobjectだけを書く。
 */
export async function workLocationHook(
	event: "post-tool-use" | "stop",
	deps: WorkLocationDeps,
): Promise<number> {
	const raw = await deps
		.readStdin(MAX_INPUT_BYTES)
		.then((buffer) => buffer.toString("utf8"))
		.catch(() => "");
	const input = parseInput(raw);
	if (input)
		await observe(event, input, deps).catch((error) =>
			report(
				deps,
				`failed (${error instanceof Error ? error.name : "unknown"})`,
			),
		);
	if (event === "stop") deps.stdout("{}\n");
	return 0;
}
