import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { describe, expect, it } from "vitest";
import { createGitRunner } from "../src/process/git.js";
import { resolveRepository } from "../src/vcs.js";

const runGit = createGitRunner({
	platform: process.platform,
	env: process.env,
	processCwd: process.cwd(),
	excludeTarget: false,
	timeoutMs: 5000,
});

function repository(remotes: Record<string, string>): string {
	const dir = tempDir("hf-repo-");
	execFileSync("git", ["init", "-q", dir]);
	for (const [name, url] of Object.entries(remotes))
		execFileSync("git", ["-C", dir, "remote", "add", name, url]);
	return dir;
}

describe("resolveRepository", () => {
	it("normalizes the origin remote of the session cwd", async () => {
		const dir = repository({
			upstream: "https://github.com/Other/Fork.git",
			origin: "git@github.com:Acme/Web.git",
		});
		mkdirSync(join(dir, "sub"));
		expect(await resolveRepository(join(dir, "sub"), runGit)).toBe(
			"github.com/acme/web",
		);
	});

	it("uses the first remote without origin", async () =>
		expect(
			await resolveRepository(
				repository({ upstream: "https://gitlab.example/acme/api" }),
				runGit,
			),
		).toBe("gitlab.example/acme/api"));

	it("has no repository outside git, without remotes, or for a missing cwd", async () => {
		expect(
			await resolveRepository(tempDir("hf-plain-"), runGit),
		).toBeUndefined();
		expect(await resolveRepository(repository({}), runGit)).toBeUndefined();
		expect(
			await resolveRepository("/nonexistent/hf-session-cwd", runGit),
		).toBeUndefined();
	});

	it("has no repository when the remote cannot be normalized", async () =>
		expect(
			await resolveRepository(
				repository({ origin: "https://gitlab.example/group/sub/api" }),
				runGit,
			),
		).toBeUndefined());

	it("does not run git for a relative cwd", async () => {
		const calls: string[] = [];
		expect(
			await resolveRepository("", async (cwd) => {
				calls.push(cwd);
				return "true";
			}),
		).toBeUndefined();
		expect(calls).toEqual([]);
	});
});
