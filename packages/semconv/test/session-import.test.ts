import { compileSchema } from "@harnessforce/test-support/validator";
import { describe, expect, it } from "vitest";
import { SessionImportSchema } from "../src/schemas/session-import.js";
import { sessionImport } from "./support/fixtures.js";

const check = compileSchema(SessionImportSchema);

describe("session import", () => {
	it("accepts the example", () => expect(check(sessionImport)).toBe(true));

	it.each([
		["offset-less ended_at", { ended_at: "2026-09-26T01:30:00" }],
		["a source other than import", { source: "hook" }],
		["negative tokens", { input_tokens: -1 }],
		["prompt body", { first_prompt: "fix the login" }],
		[
			"free-text tool name",
			{ tool_calls: [{ tool: "rm -rf /", calls: 1, failures: 0 }] },
		],
		[
			"tool output",
			{ tool_calls: [{ tool: "Bash", calls: 1, failures: 0, output: "..." }] },
		],
	])("rejects %s", (_, patch) =>
		expect(check({ ...sessionImport, ...patch })).toBe(false));

	it("requires parser_version", () => {
		const { parser_version, ...rest } = sessionImport;
		expect(check(rest)).toBe(false);
	});
});
