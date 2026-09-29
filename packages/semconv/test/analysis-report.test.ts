import { compileSchema } from "@harnessforce/test-support/validator";
import { describe, expect, it } from "vitest";
import { AnalysisReportSchema } from "../src/schemas/analysis-report.js";
import { analysisReport as r } from "./support/fixtures.js";

const check = compileSchema(AnalysisReportSchema);

describe("analysis report", () => {
	it("accepts the example", () => expect(check(r)).toBe(true));

	it.each([
		["offset-less started_at", { ...r, started_at: "2026-09-26T00:00:00" }],
		[
			"unknown intervention kind",
			{
				...r,
				interventions: { ...r.interventions, praise: r.interventions.other },
			},
		],
		[
			"missing intervention kind",
			{ ...r, interventions: { ...r.interventions, approval: undefined } },
		],
		[
			"unknown loop kind",
			{ ...r, loops: { ...r.loops, deploy: r.loops.ci_fix } },
		],
		[
			"unknown proposal kind",
			{
				...r,
				proposals: {
					...r.proposals,
					readme: { shown: 1, applied_detected: 0 },
				},
			},
		],
		[
			"unknown measurement",
			{
				...r,
				interventions: {
					...r.interventions,
					other: { ...r.interventions.other, measurement: "partial" },
				},
			},
		],
		[
			"not_measured reported as 0",
			{
				...r,
				interventions: {
					...r.interventions,
					approval: {
						measurement: "not_measured",
						count: 0,
						wait_seconds_median: null,
					},
				},
			},
		],
		[
			"measured without a count",
			{
				...r,
				interventions: {
					...r.interventions,
					other: {
						measurement: "measured",
						count: null,
						wait_seconds_median: null,
					},
				},
			},
		],
		[
			"free-text top-level field",
			{ ...r, summary: "user keeps saying continue" },
		],
		[
			"free-text inside a category",
			{
				...r,
				loops: {
					...r.loops,
					ci_fix: { ...r.loops.ci_fix, note: "flaky test" },
				},
			},
		],
		[
			"free-text server identifier",
			{
				...r,
				mcp_servers: [{ ...r.mcp_servers[1], server: "my server\nsecret" }],
			},
		],
		[
			"failures reported while not measured",
			{ ...r, mcp_servers: [{ ...r.mcp_servers[0], failures: 0 }] },
		],
		[
			"a median for zero interventions",
			{
				...r,
				interventions: {
					...r.interventions,
					other: {
						measurement: "measured",
						count: 0,
						wait_seconds_median: 0,
					},
				},
			},
		],
		[
			"no median for measured interventions",
			{
				...r,
				interventions: {
					...r.interventions,
					other: {
						measurement: "measured",
						count: 2,
						wait_seconds_median: null,
					},
				},
			},
		],
		[
			"a median for zero loop occurrences",
			{
				...r,
				loops: {
					...r.loops,
					ci_fix: {
						measurement: "measured",
						occurrences: 0,
						interventions: 0,
						duration_seconds_median: 12,
					},
				},
			},
		],
		[
			"no median for measured loop occurrences",
			{
				...r,
				loops: {
					...r.loops,
					ci_fix: {
						measurement: "measured",
						occurrences: 1,
						interventions: 0,
						duration_seconds_median: null,
					},
				},
			},
		],
	])("rejects %s", (_, value) =>
		expect(check(JSON.parse(JSON.stringify(value)))).toBe(false));

	// semantic-conventions.md「Analysis report」: measuredでは、件数が0なら中央値はnull、1以上なら数値。
	it.each([
		[
			"zero interventions without a median",
			{
				interventions: {
					...r.interventions,
					other: {
						measurement: "measured",
						count: 0,
						wait_seconds_median: null,
					},
				},
			},
		],
		[
			"zero loop occurrences without a median",
			{
				loops: {
					...r.loops,
					ci_fix: {
						measurement: "measured",
						occurrences: 0,
						interventions: 0,
						duration_seconds_median: null,
					},
				},
			},
		],
		[
			"a fractional median",
			{
				interventions: {
					...r.interventions,
					other: {
						measurement: "measured",
						count: 3,
						wait_seconds_median: 1.5,
					},
				},
			},
		],
	])("accepts %s", (_, patch) => expect(check({ ...r, ...patch })).toBe(true));
});
