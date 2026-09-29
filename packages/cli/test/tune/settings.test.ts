import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { describe, expect, it } from "vitest";
import { readSendSetting } from "../../src/tune/settings.js";

function homeWith(content: string | undefined): string {
	const home = tempDir("hf-home-");
	if (content === undefined) return home;
	mkdirSync(join(home, ".harnessforce"));
	writeFileSync(join(home, ".harnessforce", "config.json"), content);
	return home;
}

// improvement-loop.md「端末の設定」の送るかどうかの決め方（2〜5）。
describe("readSendSetting", () => {
	it.each([
		["no file", undefined, "send"],
		["no tune key", "{}", "send"],
		["no send_report key", '{"tune": {}}', "send"],
		["send_report true", '{"tune": {"send_report": true}}', "send"],
		[
			"send_report false",
			'{"tune": {"send_report": false}, "other": 1}',
			"no_send",
		],
		["a string send_report", '{"tune": {"send_report": "no"}}', "unreadable"],
		["a tune that is not an object", '{"tune": true}', "unreadable"],
		["an array", "[]", "unreadable"],
		["invalid JSON", "{", "unreadable"],
	])("reads %s as %s", async (_, content, expected) =>
		expect(await readSendSetting(homeWith(content))).toBe(expected));

	it("does not send when the file cannot be read", async () => {
		const home = tempDir("hf-home-");
		mkdirSync(join(home, ".harnessforce", "config.json"), { recursive: true });
		expect(await readSendSetting(home)).toBe("unreadable");
	});
});
