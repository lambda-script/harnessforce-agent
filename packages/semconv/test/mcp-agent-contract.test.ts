import { compileSchema } from "@harnessforce/test-support/validator";
import { describe, expect, it } from "vitest";
import {
	MCP_AGENT_QUERIES,
	MCP_AGENT_QUERY_WORD,
	MCP_AGENT_QUERY_WORD_PATTERN,
	MCP_AGENT_TOOLS,
	openResult,
} from "../src/index.js";

const tools = Object.entries(MCP_AGENT_TOOLS);

// mcp.md「agentとの契約」: この時点の契約は4つのtool、分岐に使うerrorのcode、1つの`q`。
describe("the mcp agent contract", () => {
	it("names the tools the plugin calls", () =>
		expect(Object.keys(MCP_AGENT_TOOLS).sort()).toEqual([
			"complete_session",
			"get_issue",
			"list_issues",
			"start_session",
		]));

	it("names the error codes the plugin branches on", () =>
		expect(
			Object.fromEntries(tools.map(([name, tool]) => [name, tool.errorCodes])),
		).toEqual({
			get_issue: ["not_found"],
			start_session: ["forbidden", "conflict"],
			complete_session: ["forbidden", "conflict"],
			list_issues: [],
		}));

	it.each(tools)("accepts the input examples of %s", (_, tool) => {
		const check = compileSchema(tool.input);
		for (const example of tool.inputExamples) expect(check(example)).toBe(true);
	});

	it.each(tools)("refuses an input field %s does not define", (_, tool) => {
		const check = compileSchema(tool.input);
		expect(check({ ...tool.inputExamples[0], project_key: "ENG" })).toBe(false);
	});

	it("puts the word of every query where the word pattern allows a word", () => {
		const word = new RegExp(MCP_AGENT_QUERY_WORD_PATTERN);
		for (const query of MCP_AGENT_QUERIES)
			expect(query.split(" ")).toContain(MCP_AGENT_QUERY_WORD);
		expect(["login", "auth/flow"].every((w) => word.test(w))).toBe(true);
		expect(
			["-login", "status:open", "two words"].some((w) => word.test(w)),
		).toBe(false);
	});
});

describe("the results of the mcp agent contract", () => {
	const issues = MCP_AGENT_TOOLS.list_issues.result;
	const result = {
		items: [
			{
				identifier: "acme/app#42",
				title: "Fix the login",
				updated_at: "2026-11-22T09:00:00Z",
				state: "open",
			},
		],
		next_cursor: null,
	};

	it("lets the server add fields when it is opened", () =>
		expect(compileSchema(openResult(issues))(result)).toBe(true));

	it("refuses a field the plugin does not read while it stays closed", () =>
		expect(compileSchema(issues)(result)).toBe(false));

	it("keeps the closed schema as it was after opening", () => {
		openResult(issues);
		expect(issues.additionalProperties).toBe(false);
		expect(issues.properties.items.items.additionalProperties).toBe(false);
	});
});
