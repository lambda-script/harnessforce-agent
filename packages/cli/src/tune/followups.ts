import type { AnalysisReport } from "@harnessforce/semconv";
import { median } from "./analyze.js";
import type { ProposalRecord } from "./proposals.js";
import {
	countsModels,
	LOW_CACHE_REUSE_MIN_RESPONSES,
	type ModelShares,
	modelShares,
	type SessionUsage,
} from "./usage.js";

// improvement-loop.md「前回の提案の前後」: 起点の前後14×24時間で比べる。
const PERIOD_MS = 14 * 24 * 60 * 60 * 1000;
// 前後のどちらかのsessionがこれ未満なら「比較データなし」とする。
const MIN_SESSIONS = 5;

export type FollowupSession = {
	startedAt: string;
	report: AnalysisReport;
	usage: SessionUsage;
};

type Value = number | ModelShares | null;

type Period = { from: string; to: string; sessions: number; value: Value };

export type Followup = {
	proposal_id: string;
	category: string;
	change_type: string;
	path: string;
	// 起点は適用を検出した時刻であり、実際の適用より遅れうる。
	origin: string;
	before: Period;
	after: Period;
	no_comparison_data: boolean;
	before_outside_range: boolean;
};

// 値を数えられたsessionの数と値。分母が0ならnull。
type Measure = (sessions: readonly FollowupSession[]) => {
	sessions: number;
	value: Value;
};

const ratio = (numerator: number, denominator: number) =>
	denominator === 0 ? null : numerator / denominator;

const sumOf = <T>(items: readonly T[], pick: (item: T) => number) =>
	items.reduce((total, item) => total + pick(item), 0);

type Counted = {
	measurement: "measured" | "not_measured";
	count?: number | null;
	occurrences?: number | null;
	interventions?: number | null;
};

const byKind = (group: unknown, kind: string) =>
	(group as Record<string, Counted | undefined>)[kind];

const measuredOf = (values: readonly (Counted | undefined)[]) =>
	values.filter((v): v is Counted => v?.measurement === "measured");

function measureIntervention(kind: string): Measure {
	return (sessions) => {
		const measured = measuredOf(
			sessions.map((s) => byKind(s.report.interventions, kind)),
		);
		return {
			sessions: measured.length,
			value: ratio(
				sumOf(measured, (v) => v.count ?? 0),
				measured.length,
			),
		};
	};
}

function measureLoop(kind: string): Measure {
	return (sessions) => {
		const measured = measuredOf(
			sessions.map((s) => byKind(s.report.loops, kind)),
		);
		return {
			sessions: measured.length,
			value: ratio(
				sumOf(measured, (v) => v.interventions ?? 0),
				sumOf(measured, (v) => v.occurrences ?? 0),
			),
		};
	};
}

// そのserverの要素が無いsessionは、呼び出しが0のsessionとして数える。
function measureMcp(server: string): Measure {
	return (sessions) => {
		const elements = sessions
			.map((s) => s.report.mcp_servers.find((e) => e.server === server))
			.filter(
				(e) =>
					e === undefined ||
					(e.measurement === "measured" &&
						e.failures_measurement === "measured"),
			);
		return {
			sessions: elements.length,
			value: ratio(
				sumOf(elements, (e) => e?.failures ?? 0),
				sumOf(elements, (e) => e?.calls ?? 0),
			),
		};
	};
}

const USAGE_MEASURES: Record<string, Measure> = {
	frequent_compaction: (sessions) => ({
		sessions: sessions.length,
		value: ratio(
			sumOf(sessions, (s) => s.usage.compactions_auto),
			sessions.length,
		),
	}),
	low_cache_reuse: (sessions) => {
		const ratios = sessions
			.filter((s) => s.usage.responses >= LOW_CACHE_REUSE_MIN_RESPONSES)
			.map((s) => s.usage.cache_reuse_ratio)
			.filter((r): r is number => r !== null);
		return { sessions: ratios.length, value: median(ratios) };
	},
	model_choice: (sessions) => {
		const usages = sessions.map((s) => s.usage).filter(countsModels);
		return { sessions: usages.length, value: modelShares(usages) };
	},
};

function measureOf(category: string): Measure | undefined {
	const [name, kind] = category.split(/=(.*)/s) as [string, string];
	if (name === "intervention.kind") return measureIntervention(kind);
	if (name === "loop.kind") return measureLoop(kind);
	if (name === "mcp_server") return measureMcp(kind);
	if (name === "usage.kind") return USAGE_MEASURES[kind];
	return undefined;
}

const iso = (ms: number) => new Date(ms).toISOString();

// 適用を検出した提案のうち、後の期間の満了の後に出力していないものの前後。
// `ended`は後の期間が満了した提案。`--json`の実行だけが、その記録に出力した時刻を書く。
// `rangeSinceMs`は分析の範囲の始まり。範囲に始まりが無ければundefined。
export function computeFollowups(
	proposals: readonly ProposalRecord[],
	sessions: readonly FollowupSession[],
	nowMs: number,
	rangeSinceMs: number | undefined,
): { followups: Followup[]; ended: string[] } {
	const followups: Followup[] = [];
	const ended: string[] = [];
	for (const proposal of proposals) {
		if (
			proposal.applied_detected_at === null ||
			proposal.followup_output_at !== null
		)
			continue;
		const measure = measureOf(proposal.category);
		if (measure === undefined) continue;
		const originMs = Date.parse(proposal.applied_detected_at);
		const beforeFromMs = originMs - PERIOD_MS;
		const afterToMs = Math.min(originMs + PERIOD_MS, nowMs);
		const within = (fromMs: number, toMs: number) =>
			sessions.filter((s) => {
				const ms = Date.parse(s.startedAt);
				return ms >= fromMs && ms < toMs;
			});
		const before = measure(within(beforeFromMs, originMs));
		const after = measure(within(originMs, afterToMs));
		followups.push({
			proposal_id: proposal.proposal_id,
			category: proposal.category,
			change_type: proposal.change_type,
			path: proposal.path,
			origin: iso(originMs),
			before: { from: iso(beforeFromMs), to: iso(originMs), ...before },
			after: { from: iso(originMs), to: iso(afterToMs), ...after },
			no_comparison_data:
				before.sessions < MIN_SESSIONS ||
				after.sessions < MIN_SESSIONS ||
				before.value === null ||
				after.value === null,
			before_outside_range:
				rangeSinceMs !== undefined && beforeFromMs < rangeSinceMs,
		});
		if (originMs + PERIOD_MS <= nowMs) ended.push(proposal.proposal_id);
	}
	return { followups, ended };
}
