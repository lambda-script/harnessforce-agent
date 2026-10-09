import type { SessionUsageSummary } from "@harnessforce/semconv";
import type { RecordLine } from "./store.js";

// correlation.md「要約の作り方」: 数え方と名前の対応の規則のversion。規則を変えたら上げる。
const COLLECTOR_VERSION = "0.1.0";
// semantic-conventions.md「Session usage summary」: 1つの一覧のitemsの上限。残りはotherに加える。
const MAX_ITEMS = 200;

type Calls = { calls: number; failures: number };
type CallList = { items: ({ name: string } & Calls)[]; other: Calls };

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// 識別子ごとに、PostToolUseの行を呼び出し、PostToolUseFailureの行を呼び出しと失敗に数える。
// 識別子を持たない行と、callsの多い順（同じならnameの順）で200件より後の識別子はotherに数える。
function callListOf(
	lines: readonly RecordLine[],
	kind: RecordLine["kind"],
): CallList {
	const byName = new Map<string, Calls>();
	const other = { calls: 0, failures: 0 };
	for (const line of lines) {
		if (line.kind !== kind) continue;
		let calls = other;
		if (line.id !== undefined) {
			calls = byName.get(line.id) ?? { calls: 0, failures: 0 };
			byName.set(line.id, calls);
		}
		calls.calls += 1;
		if (line.failed) calls.failures += 1;
	}
	const ranked = [...byName]
		.map(([name, calls]) => ({ name, ...calls }))
		.sort((a, b) => b.calls - a.calls || byCodeUnit(a.name, b.name));
	for (const rest of ranked.slice(MAX_ITEMS)) {
		other.calls += rest.calls;
		other.failures += rest.failures;
	}
	return { items: ranked.slice(0, MAX_ITEMS), other };
}

// commandの展開には失敗の記録が無いため、失敗を持たない一覧にする。
function commandListOf(lines: readonly RecordLine[]) {
	const { items, other } = callListOf(lines, "command");
	return {
		items: items.map(({ name, calls }) => ({ name, calls })),
		other: { calls: other.calls },
	};
}

const countOf = (lines: readonly RecordLine[], kind: RecordLine["kind"]) =>
	lines.filter((line) => line.kind === kind).length;
const compactionsOf = (lines: readonly RecordLine[], trigger: string) =>
	lines.filter((line) => line.kind === "compaction" && line.trigger === trigger)
		.length;

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
		skills: callListOf(lines, "skill"),
		commands: commandListOf(lines),
		subagents: callListOf(lines, "subagent"),
		mcp_servers: callListOf(lines, "mcp"),
		permission_requests: countOf(lines, "permission"),
		compactions: {
			auto: compactionsOf(lines, "auto"),
			manual: compactionsOf(lines, "manual"),
		},
	};
}
