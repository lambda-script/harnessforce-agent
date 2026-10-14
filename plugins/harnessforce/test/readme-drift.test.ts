import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pluginRoot = new URL("../", import.meta.url);

interface Asset {
	name: string;
	description: string;
}

// Windows checkouts convert line endings to CRLF.
function readText(url: URL): string {
	return readFileSync(url, "utf8").replace(/\r\n/g, "\n");
}

function frontmatterDescription(source: string): string {
	const match = /^---\n([\s\S]*?)\n---/.exec(source);
	const line = match?.[1]
		?.split("\n")
		.find((l) => l.startsWith("description:"));
	return line?.slice("description:".length).trim() ?? "";
}

function readSkills(): Asset[] {
	return readdirSync(new URL("skills/", pluginRoot), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => ({
			name: entry.name,
			description: frontmatterDescription(
				readText(new URL(`skills/${entry.name}/SKILL.md`, pluginRoot)),
			),
		}));
}

function readCommands(): Asset[] {
	return readdirSync(new URL("commands/", pluginRoot))
		.filter((file) => file.endsWith(".md"))
		.map((file) => ({
			name: file.replace(/\.md$/, ""),
			description: frontmatterDescription(
				readText(new URL(`commands/${file}`, pluginRoot)),
			),
		}));
}

function tableCells(readme: string, pattern: RegExp): string[] {
	return [...readme.matchAll(pattern)].map((m) => m[1] as string);
}

// "Use when ..." or "Use it when/only for ..." states the situation in which the asset is used.
const triggerClause = /\bUse (when|it)\b/;

function findDrift(
	readme: string,
	skills: Asset[],
	commands: Asset[],
): string[] {
	const problems: string[] = [];
	const tableSkills = tableCells(readme, /^\| Skill `([^`]+)` \|/gm);
	const tableCommands = tableCells(
		readme,
		/^\| Command `\/harnessforce:([^`\s]+)[^`]*` \|/gm,
	);

	for (const skill of skills) {
		if (!tableSkills.includes(skill.name)) {
			problems.push(`skill ${skill.name} has no row in the README table`);
		}
		if (!triggerClause.test(skill.description)) {
			problems.push(`skill ${skill.name} description has no trigger clause`);
		}
	}
	for (const name of tableSkills) {
		if (!skills.some((s) => s.name === name)) {
			problems.push(`README row for skill ${name} has no skills/${name}`);
		}
	}
	for (const command of commands) {
		if (!tableCommands.includes(command.name)) {
			problems.push(`command ${command.name} has no row in the README table`);
		}
	}
	for (const name of tableCommands) {
		if (!commands.some((c) => c.name === name)) {
			problems.push(
				`README row for command ${name} has no commands/${name}.md`,
			);
		}
	}
	return problems;
}

describe("plugin README, skills and commands", () => {
	it("agree with each other", () => {
		const readme = readText(new URL("README.md", pluginRoot));
		expect(findDrift(readme, readSkills(), readCommands())).toEqual([]);
	});

	describe("drift detection", () => {
		const readme = [
			"| Skill `a` | x |",
			"| Command `/harnessforce:b` | y |",
		].join("\n");
		const triggered = "Use when A.";

		it("reports nothing when they match", () => {
			expect(
				findDrift(
					readme,
					[{ name: "a", description: triggered }],
					[{ name: "b", description: "" }],
				),
			).toEqual([]);
		});

		it("reports a skill without a README row", () => {
			expect(
				findDrift(
					readme,
					[
						{ name: "a", description: triggered },
						{ name: "c", description: triggered },
					],
					[{ name: "b", description: "" }],
				),
			).toEqual(["skill c has no row in the README table"]);
		});

		it("reports a skill description without a trigger clause", () => {
			expect(
				findDrift(
					readme,
					[{ name: "a", description: "Explains A." }],
					[{ name: "b", description: "" }],
				),
			).toEqual(["skill a description has no trigger clause"]);
		});

		it("reports README rows whose asset is gone", () => {
			expect(findDrift(readme, [], [])).toEqual([
				"README row for skill a has no skills/a",
				"README row for command b has no commands/b.md",
			]);
		});

		it("reports a command without a README row", () => {
			expect(
				findDrift(
					readme,
					[{ name: "a", description: triggered }],
					[
						{ name: "b", description: "" },
						{ name: "d", description: "" },
					],
				),
			).toEqual(["command d has no row in the README table"]);
		});
	});
});
