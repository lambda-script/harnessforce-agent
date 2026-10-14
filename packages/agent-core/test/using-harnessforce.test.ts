import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { usingHarnessforceBody } from "../src/using-harnessforce.js";

const skill = readFileSync(
	new URL(
		"../../../plugins/harnessforce/skills/using-harnessforce/SKILL.md",
		import.meta.url,
	),
	"utf8",
).replace(/\r\n/g, "\n");

// correlation.md「using-harnessforce」: 注入する本文はfrontmatterを除いたSKILL.mdの本文で、80行以内。
describe("using-harnessforce body", () => {
	it("is the SKILL.md without its frontmatter", () => {
		expect(skill.startsWith("---\n")).toBe(true);
		expect(skill.endsWith(`${usingHarnessforceBody}\n`)).toBe(true);
		expect(usingHarnessforceBody).not.toContain("description:");
	});

	it("stays within 80 lines", () =>
		expect(usingHarnessforceBody.split("\n").length).toBeLessThanOrEqual(80));

	it.each([
		"## What is recorded",
		"## What is not collected",
		"## Which hook sends what",
		"## Which skill and tool to use, and when",
		"## Red Flags",
		"## Priority",
		"## Subagents",
	])("has the section %s in order", (heading) =>
		expect(usingHarnessforceBody).toContain(heading),
	);

	it("keeps the sections in the specified order", () => {
		const headings = usingHarnessforceBody.match(/^## .+$/gm);
		expect(headings).toEqual([
			"## What is recorded",
			"## What is not collected",
			"## Which hook sends what",
			"## Which skill and tool to use, and when",
			"## Red Flags",
			"## Priority",
			"## Subagents",
		]);
	});
});
