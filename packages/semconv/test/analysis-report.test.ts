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
	])("rejects %s", (_, value) =>
		expect(check(JSON.parse(JSON.stringify(value)))).toBe(false));
});
