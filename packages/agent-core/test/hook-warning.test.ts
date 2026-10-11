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
			"Harnessforceのhookには18以上のNode.jsが必要です",
		);
		expect(RESTART_FAILED_WARNING).toBe(
			"Harnessforceのhookを起動し直せませんでした",
		);
		expect(INVALID_ENDPOINT_WARNING).toBe(
			"Harnessforceの送信先が不正です。`harnessforce init`を実行し直してください",
		);
		expect(notConfiguredWarning("claude_code")).toBe(
			"Harnessforceの送信が設定されていません。`/harnessforce:setup`を実行してください",
		);
		expect(notConfiguredWarning("codex")).toBe(
			"Harnessforceの送信が設定されていません。`harnessforce init`を実行してください",
		);
		expect(REGISTRATION_FAILED_WARNING).toBe(
			"Harnessforceへのsession登録に失敗しました。通信を確かめてください",
		);
	});

	it("prints the startup failures as a systemMessage-only JSON object", () =>
		expect(JSON.parse(warningOnlyOutput(RESTART_FAILED_WARNING))).toEqual({
			systemMessage: RESTART_FAILED_WARNING,
		}));
});
