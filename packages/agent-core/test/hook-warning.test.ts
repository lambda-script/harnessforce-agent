import { describe, expect, it } from "vitest";
import {
	DESTINATION_MISMATCH_WARNING,
	INVALID_ENDPOINT_WARNING,
	keyMissingWarning,
	keyUnreadableWarning,
	notConfiguredWarning,
	REGISTRATION_FAILED_WARNING,
	RESTART_FAILED_WARNING,
	TELEMETRY_NOT_CONFIGURED_WARNING,
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

	// correlation.md「送信の健全性」: keyと送信先とテレメトリの設定の状態。Codexは止まるのが登録だけなので文言が異なる。
	it("states the sending health conditions in the specified words", () => {
		expect(keyMissingWarning("claude_code")).toBe(
			"Harnessforce cannot find your ingest key, so telemetry is not being sent. Run `harnessforce init`",
		);
		expect(keyMissingWarning("codex")).toBe(
			"Harnessforce cannot find your ingest key, so sessions are not being registered. Run `harnessforce init`",
		);
		expect(keyUnreadableWarning("claude_code")).toBe(
			"Harnessforce could not read your ingest key from the OS keychain, so telemetry may not be sent. Unlock the keychain or run `harnessforce init`",
		);
		expect(keyUnreadableWarning("codex")).toBe(
			"Harnessforce could not read your ingest key from the OS keychain, so sessions may not be registered. Unlock the keychain or run `harnessforce init`",
		);
		expect(DESTINATION_MISMATCH_WARNING.claude_code).toBe(
			"Telemetry is not being sent because the Harnessforce destination differs from the one saved by `harnessforce init`. Check this repository's settings or run `harnessforce init` again",
		);
		expect(DESTINATION_MISMATCH_WARNING.codex).toBe(
			"Sessions are not being registered because the Harnessforce destination differs from the one saved by `harnessforce init`. Run `harnessforce init` again",
		);
		expect(TELEMETRY_NOT_CONFIGURED_WARNING).toBe(
			"Claude Code telemetry for Harnessforce is not configured. Run `harnessforce init`",
		);
	});

	it("prints the startup failures as a systemMessage-only JSON object", () =>
		expect(JSON.parse(warningOnlyOutput(RESTART_FAILED_WARNING))).toEqual({
			systemMessage: RESTART_FAILED_WARNING,
		}));
});
