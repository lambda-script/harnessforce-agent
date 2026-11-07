import { isObject } from "@harnessforce/agent-core/object";
import type { AttributionSession } from "./proposals.js";
import { readJsonFile } from "./store.js";

// improvement-loop.md「端末のfile」の`analysis.json`: 直近の分析の実行の`sessions`。
export async function readAnalysisSessions(
	path: string,
): Promise<Map<string, AttributionSession>> {
	const value = await readJsonFile(path);
	const sessions =
		isObject(value) && Array.isArray(value.sessions) ? value.sessions : [];
	const found = new Map<string, AttributionSession>();
	for (const session of sessions) {
		if (
			!isObject(session) ||
			typeof session.agent_session_id !== "string" ||
			typeof session.started_at !== "string" ||
			!(typeof session.sendable === "boolean" || session.sendable === null)
		)
			continue;
		found.set(session.agent_session_id, {
			sessionId: session.agent_session_id,
			startedAt: session.started_at,
			sendable: session.sendable,
		});
	}
	return found;
}
