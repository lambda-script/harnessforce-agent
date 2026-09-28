import { compileSchema } from "@harnessforce/test-support/validator";
import { describe, expect, it } from "vitest";
import { SessionRegistrationSchema } from "../src/schemas/session-registration.js";
import { sessionRegistration } from "./support/fixtures.js";

const check = compileSchema(SessionRegistrationSchema);

describe("session registration", () => {
	it("accepts the full example", () =>
		expect(check(sessionRegistration)).toBe(true));

	it("accepts the minimal hook registration (optional fields omitted)", () => {
		const {
			first_prompt_id,
			repository,
			branch,
			commit,
			issue_identifier,
			...minimal
		} = sessionRegistration;
		expect(check({ ...minimal, source: "hook" })).toBe(true);
	});

	// semantic-conventions.md「session registration」: 空白を含まない1〜300文字。
	it("accepts a 300-character issue identifier", () =>
		expect(
			check({ ...sessionRegistration, issue_identifier: "x".repeat(300) }),
		).toBe(true));

	it.each([
		["a 301-character issue identifier", { issue_identifier: "x".repeat(301) }],
		["an issue identifier with spaces", { issue_identifier: "ENG 42" }],
		["offset-less started_at", { started_at: "2026-09-26T09:00:00" }],
		["unknown source", { source: "webhook" }],
		["unknown agent", { agent: "cursor" }],
		["repository without host", { repository: "acme/web" }],
		["unknown field", { prompt: "please fix login" }],
	])("rejects %s", (_, patch) =>
		expect(check({ ...sessionRegistration, ...patch })).toBe(false));
});
