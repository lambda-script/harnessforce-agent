import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { launchAgent, runGit } from "../../src/run/process.js";
import { tempDir } from "../config/support.js";

describe("launchAgent", () => {
	it("runs the agent with the given environment and returns its exit code", async () => {
		const out = join(tempDir("hf-launch-"), "env.json");
		const outcome = await launchAgent({
			command: process.execPath,
			args: [
				"-e",
				`require("node:fs").writeFileSync(${JSON.stringify(out)}, JSON.stringify({ issue: process.env.HARNESSFORCE_ISSUE, argv: process.argv.slice(1) })); process.exit(7)`,
				"a b",
			],
			env: { HARNESSFORCE_ISSUE: "ENG-42" },
		});
		expect(outcome).toEqual({ kind: "exited", code: 7 });
		const { readFileSync } = await import("node:fs");
		expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({
			issue: "ENG-42",
			argv: ["a b"],
		});
	});

	it("reports a signal as 128 plus its number", async () =>
		expect(
			await launchAgent({
				command: process.execPath,
				args: ["-e", "process.kill(process.pid, 'SIGTERM')"],
				env: {},
			}),
		).toEqual({ kind: "exited", code: 143 }));

	it("fails when the arguments cannot be passed to a process", async () =>
		expect(
			await launchAgent({
				command: process.execPath,
				args: ["a\u0000b"],
				env: {},
			}),
		).toEqual({ kind: "failed" }));

	it("fails when the agent cannot be started", async () =>
		expect(
			await launchAgent({
				command: "hf-run-agent-that-does-not-exist",
				args: [],
				env: { PATH: "/nonexistent" },
			}),
		).toEqual({ kind: "failed" }));
});

describe("runGit", () => {
	const git = (cwd: string, ...args: string[]) =>
		execFileSync("git", ["-C", cwd, ...args], {
			env: {
				...process.env,
				GIT_AUTHOR_NAME: "t",
				GIT_AUTHOR_EMAIL: "t@example.test",
				GIT_COMMITTER_NAME: "t",
				GIT_COMMITTER_EMAIL: "t@example.test",
			},
		});

	it("answers from cwd and ignores inherited GIT_ variables", async () => {
		const repo = tempDir("hf-git-");
		git(repo, "init", "-q", "-b", "eng-42-login");
		git(repo, "commit", "-q", "--allow-empty", "-m", "init");
		const other = tempDir("hf-git-other-");
		const previous = process.env.GIT_DIR;
		process.env.GIT_DIR = join(other, "not-a-repo");
		mkdirSync(process.env.GIT_DIR);
		try {
			expect(
				await runGit(repo, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
			).toBe("eng-42-login");
		} finally {
			if (previous === undefined) delete process.env.GIT_DIR;
			else process.env.GIT_DIR = previous;
		}
	});

	it("returns undefined when git fails", async () =>
		expect(
			await runGit(tempDir("hf-git-none-"), ["rev-parse", "HEAD"]),
		).toBeUndefined());
});
