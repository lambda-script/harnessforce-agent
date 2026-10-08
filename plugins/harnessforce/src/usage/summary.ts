import type { SessionUsageSummary } from "@harnessforce/semconv";
import type { RecordLine } from "./store.js";

// correlation.md「要約の作り方」: 数え方と名前の対応の規則のversion。規則を変えたら上げる。
const COLLECTOR_VERSION = "0.1.0";

const byTime = (lines: readonly RecordLine[]) =>
	lines
		.map((line, order) => ({ line, ms: Date.parse(line.at), order }))
		.sort((a, b) => a.ms - b.ms || a.order - b.order)
		.map(({ line }) => line);

// 記録の行が1つも無ければ、時刻を決められないため要約を作らない。
export function buildSummary(
	sessionId: string,
	lines: readonly RecordLine[],
): SessionUsageSummary | undefined {
	const ordered = byTime(lines);
	const first = ordered[0];
	const last = ordered.at(-1);
	if (!first || !last) return undefined;
	const firstPromptId = ordered.find((line) => line.promptId)?.promptId;
	return {
		agent: "claude_code",
		session_id: sessionId,
		...(firstPromptId === undefined ? {} : { first_prompt_id: firstPromptId }),
		started_at: first.at,
		last_event_at: last.at,
		collector_version: COLLECTOR_VERSION,
		skills: { items: [], other: { calls: 0, failures: 0 } },
		commands: { items: [], other: { calls: 0 } },
		subagents: { items: [], other: { calls: 0, failures: 0 } },
		mcp_servers: { items: [], other: { calls: 0, failures: 0 } },
		permission_requests: 0,
		compactions: { auto: 0, manual: 0 },
	};
}
