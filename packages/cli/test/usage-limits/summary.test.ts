import { describe, expect, it } from "vitest";
import {
	isDue,
	stateFor,
	summaryFrom,
} from "../../src/usage-limits/summary.js";

const NOW = Date.parse("2026-10-10T05:30:00Z");
const FIVE_HOUR_RESET = Date.parse("2026-10-10T08:00:00Z") / 1000;
const SEVEN_DAY_RESET = Date.parse("2026-10-14T00:00:00Z") / 1000;
const stdin = (limits: unknown, rest: object = {}) =>
	JSON.stringify({ rate_limits: limits, ...rest });
const both = {
	five_hour: { used_percentage: 42, resets_at: FIVE_HOUR_RESET },
	seven_day: { used_percentage: 17.5, resets_at: SEVEN_DAY_RESET },
};

describe("usage limit summary from the statusLine JSON", () => {
	it("keeps only the percentage and reset time of the five-hour and seven-day windows", () => {
		const summary = summaryFrom(
			stdin(both, {
				cwd: "/secret/project",
				transcript_path: "/secret/t.jsonl",
				cost: { total_cost_usd: 1 },
			}),
			NOW,
		);
		expect(summary).toEqual({
			agent: "claude_code",
			observed_at: "2026-10-10T05:30:00Z",
			windows: [
				{
					window_minutes: 300,
					used_percent: 42,
					resets_at: "2026-10-10T08:00:00Z",
				},
				{
					window_minutes: 10080,
					used_percent: 17.5,
					resets_at: "2026-10-14T00:00:00Z",
				},
			],
		});
		expect(JSON.stringify(summary)).not.toContain("secret");
	});

	it("does not name the window nor carry its extra fields", () => {
		const summary = summaryFrom(
			stdin({
				model_scoped: { used_percentage: 5, resets_at: SEVEN_DAY_RESET },
				five_hour: {
					used_percentage: 1,
					resets_at: FIVE_HOUR_RESET,
					extra: "x",
				},
			}),
			NOW,
		);
		expect(summary?.windows).toEqual([
			{
				window_minutes: 300,
				used_percent: 1,
				resets_at: "2026-10-10T08:00:00Z",
			},
		]);
	});

	it.each([
		["a window without resets_at", { five_hour: { used_percentage: 1 } }],
		[
			"a window that already reset",
			{ five_hour: { used_percentage: 1, resets_at: NOW / 1000 } },
		],
		[
			"a percentage above 100",
			{ five_hour: { used_percentage: 101, resets_at: FIVE_HOUR_RESET } },
		],
		[
			"a negative percentage",
			{ five_hour: { used_percentage: -1, resets_at: FIVE_HOUR_RESET } },
		],
		[
			"a percentage that is not a number",
			{ five_hour: { used_percentage: "9", resets_at: FIVE_HOUR_RESET } },
		],
		["no window", {}],
	])("sends nothing for %s", (_name, limits) => {
		expect(summaryFrom(stdin(limits), NOW)).toBeUndefined();
	});

	it("drops only the broken window", () => {
		const summary = summaryFrom(
			stdin({ ...both, five_hour: { used_percentage: 200, resets_at: 1 } }),
			NOW,
		);
		expect(summary?.windows.map((w) => w.window_minutes)).toEqual([10080]);
	});

	it.each([
		["not JSON", "{"],
		["an array", "[]"],
		["without rate_limits", "{}"],
		["with rate_limits that is not an object", stdin("x")],
	])("sends nothing for stdin %s", (_name, input) => {
		expect(summaryFrom(input, NOW)).toBeUndefined();
	});
});

describe("when to send", () => {
	const summary = summaryFrom(stdin(both), NOW);
	if (!summary) throw new Error("fixture");

	it("sends the first time", () => {
		expect(isDue(summary, undefined, NOW)).toBe(true);
	});

	it("waits five minutes when the reset times are the same", () => {
		const state = stateFor(summary, NOW);
		expect(isDue(summary, state, NOW + 5 * 60_000 - 1)).toBe(false);
		expect(isDue(summary, state, NOW + 5 * 60_000)).toBe(true);
	});

	it("does not wait when a window has a new reset time", () => {
		const state = stateFor(summary, NOW);
		const next = summaryFrom(
			stdin({
				...both,
				five_hour: {
					used_percentage: 3,
					resets_at: FIVE_HOUR_RESET + 5 * 3600,
				},
			}),
			NOW + 1000,
		);
		expect(next && isDue(next, state, NOW + 1000)).toBe(true);
	});
});
