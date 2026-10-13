import { describe, expect, it } from "vitest";
import {
	INVALID_ENDPOINT_WARNING,
	notConfiguredWarning,
	REGISTRATION_FAILED_WARNING,
	RESTART_FAILED_WARNING,
	UNSUPPORTED_NODE_WARNING,
	warningOnlyOutput,
} from "../src/hook-warning.js";

// correlation.md「hookの警告」の表の文言。
describe("hook warnings", () => {
	it("states the five conditions in the specified words", () => {
		expect(UNSUPPORTED_NODE_WARNING).toBe(
			"Harnessforce hooks require Node.js 18 or later",
		);
		expect(RESTART_FAILED_WARNING).toBe(
			"Could not restart the Harnessforce hook",
		);
		expect(INVALID_ENDPOINT_WARNING).toBe(
			"The Harnessforce destination is invalid. Run `harnessforce init` again",
		);
		expect(notConfiguredWarning("claude_code")).toBe(
			"Harnessforce sending is not configured. Run `/harnessforce:setup`",
		);
		expect(notConfiguredWarning("codex")).toBe(
			"Harnessforce sending is not configured. Run `harnessforce init`",
		);
		expect(REGISTRATION_FAILED_WARNING).toBe(
			"Harnessforce session registration failed. Check your network connection",
		);
	});

	it("prints the startup failures as a systemMessage-only JSON object", () =>
		expect(JSON.parse(warningOnlyOutput(RESTART_FAILED_WARNING))).toEqual({
			systemMessage: RESTART_FAILED_WARNING,
		}));
});
