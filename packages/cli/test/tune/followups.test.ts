import type { AnalysisReport } from "@harnessforce/semconv";
import { describe, expect, it } from "vitest";
import { emptyProposalCounts } from "../../src/tune/analyze.js";
import {
	computeFollowups,
	type FollowupSession,
} from "../../src/tune/followups.js";
import type { ProposalRecord } from "../../src/tune/proposals.js";
import type { SessionUsage } from "../../src/tune/usage.js";

// improvement-loop.md「前回の提案の前後」
const DAY_MS = 86_400_000;
const ORIGIN = Date.parse("2026-09-20T00:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

const proposal = (
	category: string,
	fields: Partial<ProposalRecord> = {},
): ProposalRecord => ({
	proposal_id: `p-${category}`,
	category,
	change_type: "skill",
	scope: "user",
	path: "/home/u/.claude/skills/x/SKILL.md",
	project_root: null,
	component: { kind: "skill", source: "user", id: "x" },
	expected_hash: "h",
	detects_applied: true,
	recorded_at: iso(ORIGIN - 3 * DAY_MS),
	evidence_session_ids: ["s0"],
	attribution: "decided",
	attributed_session_id: null,
	applied_detected_at: iso(ORIGIN),
	followup_output_at: null,
	...fields,
});

const USAGE: SessionUsage = {
	compactions_auto: 0,
	compactions_manual: 0,
	responses: 1,
	cache_reuse_ratio: null,
	models: [],
	subagent_models: [],
	kinds: [],
};

function report(
	fields: Partial<Pick<AnalysisReport, "mcp_servers">> & {
		approval?: number | null;
		ciFix?: [number, number];
	} = {},
): AnalysisReport {
	const measured = (count: number | null) =>
		count === null
			? { measurement: "not_measured", count: null, wait_seconds_median: null }
			: { measurement: "measured", count, wait_seconds_median: null };
	const loop = ([occurrences, interventions]: [number, number]) => ({
		measurement: "measured",
		occurrences,
		interventions,
		duration_seconds_median: occurrences > 0 ? 1 : null,
	});
	return {
		agent: "claude_code",
		session_id: "x",
		started_at: iso(ORIGIN),
		analyzer_version: "1.1.0",
		parser_version: "1.1.0",
		interventions: {
			approval: measured(fields.approval === undefined ? 0 : fields.approval),
			continue: measured(0),
			ci_relay: measured(0),
			review_relay: measured(0),
			answer: measured(null),
			other: measured(0),
		},
		loops: {
			issue_to_pr: loop([0, 0]),
			ci_fix: loop(fields.ciFix ?? [0, 0]),
			review_response: loop([0, 0]),
			test_fix: loop([0, 0]),
			lint_fix: loop([0, 0]),
			dependency_update: loop([0, 0]),
		},
		mcp_servers: fields.mcp_servers ?? [],
		proposals: emptyProposalCounts(),
		records_skipped: 0,
	} as AnalysisReport;
}

// `before`個のsessionを起点の前の期間に、`after`個を後の期間に置く。
function sessions(
	before: number,
	after: number,
	make: (isAfter: boolean, index: number) => Partial<FollowupSession>,
): FollowupSession[] {
	const at = (ms: number, isAfter: boolean, index: number) => ({
		startedAt: iso(ms),
		report: report(),
		usage: USAGE,
		...make(isAfter, index),
	});
	return [
		...Array.from({ length: before }, (_, i) =>
			at(ORIGIN - (i + 1) * DAY_MS, false, i),
		),
		...Array.from({ length: after }, (_, i) =>
			at(ORIGIN + i * DAY_MS, true, i),
		),
	];
}

const NOW = ORIGIN + 20 * DAY_MS;
const follow = (
	proposals: ProposalRecord[],
	list: FollowupSession[],
	nowMs = NOW,
	rangeSinceMs: number | undefined = ORIGIN - 20 * DAY_MS,
) => computeFollowups(proposals, list, nowMs, rangeSinceMs);

describe("前回の提案の前後", () => {
	it("compares interventions per session in the 14 days before and after the detection time", () => {
		const list = sessions(6, 5, (isAfter) => ({
			report: report({ approval: isAfter ? 1 : 3 }),
		}));
		// 14日より前と、後の期間の後のsessionは比べない。
		list.push(
			{
				startedAt: iso(ORIGIN - 15 * DAY_MS),
				report: report({ approval: 50 }),
				usage: USAGE,
			},
			{
				startedAt: iso(ORIGIN + 14 * DAY_MS),
				report: report({ approval: 50 }),
				usage: USAGE,
			},
		);
		const { followups, ended } = follow(
			[proposal("intervention.kind=approval")],
			list,
		);
		expect(followups).toEqual([
			{
				proposal_id: "p-intervention.kind=approval",
				category: "intervention.kind=approval",
				change_type: "skill",
				path: "/home/u/.claude/skills/x/SKILL.md",
				origin: iso(ORIGIN),
				before: {
					from: iso(ORIGIN - 14 * DAY_MS),
					to: iso(ORIGIN),
					sessions: 6,
					value: 3,
				},
				after: {
					from: iso(ORIGIN),
					to: iso(ORIGIN + 14 * DAY_MS),
					sessions: 5,
					value: 1,
				},
				no_comparison_data: false,
				before_outside_range: false,
			},
		]);
		expect(ended).toEqual(["p-intervention.kind=approval"]);
	});

	it("has no comparison data with fewer than 5 sessions on a side, and ends the after period at the run", () => {
		const nowMs = ORIGIN + 4 * DAY_MS + 1;
		const { followups, ended } = follow(
			[proposal("intervention.kind=approval")],
			sessions(6, 5, () => ({})),
			nowMs,
		);
		expect(followups[0]).toMatchObject({
			after: { to: iso(nowMs), sessions: 5 },
			no_comparison_data: false,
		});
		expect(ended).toEqual([]);
		const fewer = follow(
			[proposal("intervention.kind=approval")],
			sessions(6, 4, () => ({})),
		);
		expect(fewer.followups[0]).toMatchObject({
			after: { sessions: 4, value: 0 },
			no_comparison_data: true,
		});
	});

	it("leaves out not measured sessions and gives null, not 0, on a zero denominator", () => {
		const { followups } = follow(
			[proposal("intervention.kind=approval")],
			sessions(6, 6, () => ({ report: report({ approval: null }) })),
		);
		expect(followups[0]).toMatchObject({
			before: { sessions: 0, value: null },
			after: { sessions: 0, value: null },
			no_comparison_data: true,
		});
	});

	it("compares loop interventions per occurrence and MCP failures per call", () => {
		const mcp = (failures: number | null, calls: number) => ({
			server: "github",
			configured: true,
			measurement: "measured" as const,
			calls,
			failures_measurement:
				failures === null ? ("not_measured" as const) : ("measured" as const),
			failures,
		});
		const list = sessions(5, 6, (isAfter, i) => ({
			report: report({
				ciFix: isAfter ? [2, 1] : [1, 2],
				// 後の期間の1つは失敗を計測していない。
				mcp_servers: [mcp(isAfter && i === 0 ? null : isAfter ? 0 : 1, 2)],
			}),
		}));
		const { followups } = follow(
			[proposal("loop.kind=ci_fix"), proposal("mcp_server=github")],
			list,
		);
		expect(followups.map((f) => [f.before, f.after])).toEqual([
			[
				expect.objectContaining({ sessions: 5, value: 2 }),
				expect.objectContaining({ sessions: 6, value: 0.5 }),
			],
			[
				expect.objectContaining({ sessions: 5, value: 0.5 }),
				expect.objectContaining({ sessions: 5, value: 0 }),
			],
		]);
	});

	it("compares the usage values: auto compactions per session, the median cache reuse of sessions with 20 responses, and model shares", () => {
		const list = sessions(5, 5, (isAfter, i) => ({
			usage: {
				...USAGE,
				compactions_auto: isAfter ? 0 : 2,
				responses: i === 0 ? 19 : 20,
				cache_reuse_ratio: isAfter ? 0.8 : i < 3 ? 0.25 : 0.5,
				models: [
					{
						model: "claude-opus-5-5",
						responses: 1,
						output_tokens: isAfter ? 60 : 100,
					},
				],
				subagent_models: isAfter
					? [{ model: "claude-haiku-4-5", responses: 1, output_tokens: 40 }]
					: [],
			},
		}));
		const { followups } = follow(
			[
				proposal("usage.kind=frequent_compaction"),
				proposal("usage.kind=low_cache_reuse"),
				proposal("usage.kind=model_choice", { change_type: "agent" }),
			],
			list,
		);
		expect(followups.map((f) => [f.before, f.after])).toEqual([
			[
				expect.objectContaining({ sessions: 5, value: 2 }),
				expect.objectContaining({ sessions: 5, value: 0 }),
			],
			[
				// 応答が19のsessionは除き、0.25、0.25、0.5、0.5の中央値。
				expect.objectContaining({ sessions: 4, value: 0.375 }),
				expect.objectContaining({ sessions: 4, value: 0.8 }),
			],
			[
				expect.objectContaining({
					sessions: 5,
					value: {
						main: [{ model: "claude-opus-5-5", share: 1 }],
						subagent: [],
					},
				}),
				expect.objectContaining({
					sessions: 5,
					value: {
						main: [{ model: "claude-opus-5-5", share: 0.6 }],
						subagent: [{ model: "claude-haiku-4-5", share: 0.4 }],
					},
				}),
			],
		]);
		expect(followups[1]?.no_comparison_data).toBe(true);
	});

	it("notes when the before period starts before the analysis range", () => {
		const list = sessions(5, 5, () => ({}));
		expect(
			follow(
				[proposal("intervention.kind=approval")],
				list,
				NOW,
				ORIGIN - 10 * DAY_MS,
			).followups[0]?.before_outside_range,
		).toBe(true);
		expect(
			follow([proposal("intervention.kind=approval")], list, NOW, undefined)
				.followups[0]?.before_outside_range,
		).toBe(false);
	});

	it("covers only detected proposals whose follow-up after the period has not been output", () => {
		const { followups } = follow(
			[
				proposal("intervention.kind=approval", { applied_detected_at: null }),
				proposal("intervention.kind=continue", {
					followup_output_at: iso(NOW - DAY_MS),
				}),
				proposal("intervention.kind=other"),
			],
			sessions(5, 5, () => ({})),
		);
		expect(followups.map((f) => f.category)).toEqual([
			"intervention.kind=other",
		]);
	});
});
