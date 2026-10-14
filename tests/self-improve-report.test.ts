import { describe, expect, it } from "vitest";
import {
	buildReport,
	isoWeek,
	upsertIssue,
} from "../scripts/self-improve-report.mjs";

describe("isoWeek", () => {
	it("names the ISO week of a date", () => {
		expect(isoWeek(new Date("2026-10-14T00:00:00Z"))).toBe("2026-W42");
		expect(isoWeek(new Date("2027-01-03T00:00:00Z"))).toBe("2026-W53");
	});
});

describe("buildReport", () => {
	const week = "2026-W42";

	it("says not measured, never 0, for a metric without data", () => {
		const { body } = buildReport({ correlation_rate: 0.5 }, week);
		expect(body).toMatch(/permission_prompts_per_run.*not measured/);
		expect(body).not.toMatch(/permission_prompts_per_run.*\b0\b/);
	});

	it("keeps a measured 0 as 0", () => {
		const { body } = buildReport({ permission_prompts_per_run: 0 }, week);
		expect(body).toMatch(/permission_prompts_per_run.*\| 0 \|/);
	});

	it("lists metrics that moved the wrong way against the previous value", () => {
		const { body } = buildReport(
			{ ci_first_pass: 0.4, permission_prompts_per_run: 1 },
			week,
			{ ci_first_pass: 0.8, permission_prompts_per_run: 3 },
		);
		expect(body).toContain("Moved the wrong way: ci_first_pass");
		expect(body).not.toContain("wrong way: ci_first_pass, permission");
	});

	it("carries a marker line unique to the week", () => {
		const { marker, body } = buildReport({}, week);
		expect(marker).toBe("<!-- self-improve-report:2026-W42 -->");
		expect(body.split("\n")[0]).toBe(marker);
	});
});

describe("upsertIssue", () => {
	const report = buildReport({ correlation_rate: 1 }, "2026-W42");

	it("creates the issue when none carries the marker", async () => {
		const calls: string[][] = [];
		await upsertIssue(report, async (args) => {
			calls.push(args);
			return args[1] === "list" ? "[]" : "";
		});
		expect(calls.map((c) => c.slice(0, 2).join(" "))).toEqual([
			"issue list",
			"issue create",
		]);
	});

	it("updates the same issue when run twice in a week", async () => {
		const calls: string[][] = [];
		await upsertIssue(report, async (args) => {
			calls.push(args);
			return args[1] === "list"
				? JSON.stringify([{ number: 7, body: `${report.marker}\nold` }])
				: "";
		});
		expect(calls.map((c) => c.slice(0, 3).join(" "))).toEqual([
			"issue list --search",
			"issue edit 7",
		]);
	});

	it("only calls read and own-repository issue commands", async () => {
		const calls: string[][] = [];
		await upsertIssue(report, async (args) => {
			calls.push(args);
			return "[]";
		});
		expect(calls.every((c) => c[0] === "issue")).toBe(true);
	});
});
