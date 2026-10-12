import { compileSchema } from "@harnessforce/test-support/validator";
import { describe, expect, it } from "vitest";
import { SessionUsageSummarySchema } from "../src/schemas/session-usage-summary.js";
import { sessionUsageSummary as u } from "./support/fixtures.js";

const check = compileSchema(SessionUsageSummarySchema);

const skillItems = (count: number) =>
	Array.from({ length: count }, (_, i) => ({
		name: `skill-${i}`,
		calls: 1,
		failures: 0,
	}));

describe("session usage summary", () => {
	it("accepts the example", () => expect(check(u)).toBe(true));

	it.each([
		["without first_prompt_id", { first_prompt_id: undefined }],
		[
			"200 items in a list",
			{ skills: { items: skillItems(200), other: u.skills.other } },
		],
		[
			"a 256 code point name",
			{
				skills: {
					items: [{ name: "a".repeat(256), calls: 1, failures: 1 }],
					other: u.skills.other,
				},
			},
		],
	])("accepts a summary %s", (_, overrides) =>
		expect(check(JSON.parse(JSON.stringify({ ...u, ...overrides })))).toBe(
			true,
		));

	it.each([
		["offset-less last_event_at", { last_event_at: "2026-09-26T01:30:00" }],
		["a missing collector_version", { collector_version: undefined }],
		[
			"201 items in a list",
			{ skills: { items: skillItems(201), other: u.skills.other } },
		],
		[
			"an item without calls",
			{
				subagents: {
					items: [{ name: "reviewer", calls: 0, failures: 0 }],
					other: u.subagents.other,
				},
			},
		],
		[
			"a command item with failures",
			{
				commands: {
					items: [{ name: "deploy", calls: 1, failures: 0 }],
					other: u.commands.other,
				},
			},
		],
		[
			"command other with failures",
			{ commands: { items: [], other: { calls: 0, failures: 0 } } },
		],
		[
			"the arguments of a command",
			{
				commands: {
					items: [{ name: "deploy", calls: 1, args: "--prod" }],
					other: u.commands.other,
				},
			},
		],
		[
			"a name with white space",
			{
				mcp_servers: {
					items: [{ name: "my server", calls: 1, failures: 0 }],
					other: u.mcp_servers.other,
				},
			},
		],
		[
			"a name over 256 code points",
			{
				skills: {
					items: [{ name: "a".repeat(257), calls: 1, failures: 0 }],
					other: u.skills.other,
				},
			},
		],
		["a list without other", { skills: { items: [] } }],
		[
			"a compaction trigger other than auto and manual",
			{
				compactions: { auto: 0, manual: 0, resume: 1 },
			},
		],
		["compactions without manual", { compactions: { auto: 1 } }],
		["negative permission requests", { permission_requests: -1 }],
		["an unknown top-level field", { prompt: "fix the build" }],
	])("rejects %s", (_, overrides) =>
		expect(check(JSON.parse(JSON.stringify({ ...u, ...overrides })))).toBe(
			false,
		));
});
