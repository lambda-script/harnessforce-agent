import { describe, expect, it } from "vitest";
import { SessionRegistrationSchema } from "../src/schemas/session-registration.js";
import { sessionRegistration } from "./support/fixtures.js";
import { compile } from "./support/validator.js";

const check = compile(SessionRegistrationSchema);

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

	it.each([
		["offset-less started_at", { started_at: "2026-09-26T09:00:00" }],
		["unknown source", { source: "webhook" }],
		["unknown agent", { agent: "cursor" }],
		["repository without host", { repository: "acme/web" }],
		["unknown field", { prompt: "please fix login" }],
	])("rejects %s", (_, patch) =>
		expect(check({ ...sessionRegistration, ...patch })).toBe(false));
});
