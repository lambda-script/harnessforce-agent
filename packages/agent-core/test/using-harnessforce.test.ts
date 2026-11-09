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
		"## The rule",
		"## Session ID",
		"## What is sent, and when",
		"## What is not collected",
		"## Red Flags",
		"## Priority",
	])("has the section %s in order", (heading) =>
		expect(usingHarnessforceBody).toContain(heading),
	);

	// correlation.md「using-harnessforce」の5: Red Flagsの言い訳は9つ。
	it("lists the nine Red Flags of the spec", () => {
		const section = /## Red Flags\n([\s\S]*?)\n## Priority/.exec(
			usingHarnessforceBody,
		)?.[1];
		const redFlags = section?.match(/^\| (?!Thought \||---).+$/gm);
		expect(redFlags).toHaveLength(9);
		expect(usingHarnessforceBody).toContain(
			"| `start_session` returned `conflict`, so I will call it again or try another session ID |",
		);
	});

	// correlation.md「using-harnessforce」: 第三者のpluginの文として、強調で利用者の指示より強く読ませない。
	it("states the rules without emphasis", () =>
		expect(usingHarnessforceBody).not.toMatch(
			/<[A-Z_]+>|\b(MUST|NEVER|ALWAYS|IMPORTANT)\b/,
		));

	it("keeps the sections in the specified order", () => {
		const headings = usingHarnessforceBody.match(/^## .+$/gm);
		expect(headings).toEqual([
			"## The rule",
			"## Session ID",
			"## What is sent, and when",
			"## What is not collected",
			"## Red Flags",
			"## Priority",
		]);
	});
});
