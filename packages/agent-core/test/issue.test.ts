import { describe, expect, it } from "vitest";
import { isIssueIdentifier } from "../src/issue.js";

// semantic-conventions.md「値の形」のtoken(300): Unicodeの`White_Space`を含まず、code pointで1〜300文字。
describe("isIssueIdentifier", () => {
	it.each([
		"ENG-42",
		"acme/web#12",
		"\u{1F600}".repeat(300),
	])("accepts %s", (value) => expect(isIssueIdentifier(value)).toBe(true));
	it.each([
		["empty", ""],
		["a space", "ENG 42"],
		["NEL (U+0085)", "ENG\u008542"],
		["301 characters", "a".repeat(301)],
		["301 code points", "\u{1F600}".repeat(301)],
	])("rejects %s", (_, value) => expect(isIssueIdentifier(value)).toBe(false));
});
