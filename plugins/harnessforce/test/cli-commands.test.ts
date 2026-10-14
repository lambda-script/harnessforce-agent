import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Windowsのcheckoutは改行をCRLFへ変えるため、frontmatterの正規表現の前にLFへ揃える。
const read = (name: string) =>
	readFileSync(
		fileURLToPath(new URL(`../commands/${name}.md`, import.meta.url)),
		"utf8",
	).replaceAll("\r\n", "\n");

function parse(name: string) {
	const source = read(name);
	const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source);
	if (!match) throw new Error(`${name}.md has no frontmatter`);
	const frontmatter = Object.fromEntries(
		(match[1] as string).split("\n").map((line) => {
			const at = line.indexOf(":");
			return [line.slice(0, at), line.slice(at + 1).trim()];
		}),
	);
	const body = match[2] as string;
	const commands = [...body.matchAll(/```sh\n([\s\S]*?)```/g)].flatMap(
		(block) =>
			(block[1] as string)
				.split("\n")
				.map((line) => line.trim())
				.filter(Boolean),
	);
	return { frontmatter, body, commands };
}

// Each wrapped command: the only shell lines the command body may tell the agent to run.
const WRAPPED = {
	status: { argumentHint: false, commands: ["harnessforce top --once --json"] },
	import: { argumentHint: false, commands: ["harnessforce import"] },
	"usage-limits": {
		argumentHint: false,
		commands: ["harnessforce usage-limits status"],
	},
	run: { argumentHint: true, commands: [] },
	help: { argumentHint: false, commands: ["harnessforce --help"] },
} as const;

describe("CLI-wrapping commands", () => {
	for (const [name, expected] of Object.entries(WRAPPED)) {
		describe(`/harnessforce:${name}`, () => {
			const { frontmatter, body, commands } = parse(name);

			it("is invoked only by the user", () => {
				expect(frontmatter["disable-model-invocation"]).toBe("true");
			});

			it("has an English description", () => {
				expect(frontmatter.description).toMatch(/^[\x20-\x7e]{20,}$/);
			});

			it("declares an argument-hint only when it takes an argument", () => {
				expect("argument-hint" in frontmatter).toBe(expected.argumentHint);
			});

			it("runs only the pinned commands", () => {
				expect(commands).toEqual(expected.commands);
			});

			it("is written in English", () => {
				expect(body).not.toMatch(/[　-ヿ一-鿿]/);
			});
		});
	}

	it("/harnessforce:run never asks the agent to start an agent", () => {
		const { body } = parse("run");
		expect(body).toContain("harnessforce run --issue");
		expect(body).toContain("HARNESSFORCE_ISSUE");
	});

	it("/harnessforce:usage-limits leaves on and off to the user", () => {
		const { body, commands } = parse("usage-limits");
		expect(commands.join("\n")).not.toMatch(/usage-limits (on|off)/);
		expect(body).toContain("!harnessforce usage-limits on");
	});

	it("/harnessforce:help sends init to /harnessforce:setup", () => {
		expect(parse("help").body).toContain("/harnessforce:setup");
	});
});
