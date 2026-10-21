import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { describe, expect, it } from "vitest";
import { createGitRunner } from "../src/process/git.js";
import {
	codexLocationStatePath,
	emptyLocationState,
	locationsToSend,
	observedDirectories,
	observePair,
	readLocationState,
	withObservedPair,
	writeLocationState,
} from "../src/work-location.js";

const runGit = createGitRunner({
	platform: process.platform,
	env: process.env,
	processCwd: process.cwd(),
	excludeTarget: false,
	timeoutMs: 5000,
});

const git = (dir: string, ...args: string[]) =>
	execFileSync("git", ["-C", dir, ...args], {
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "t",
			GIT_AUTHOR_EMAIL: "t@example.com",
			GIT_COMMITTER_NAME: "t",
			GIT_COMMITTER_EMAIL: "t@example.com",
		},
	});

/** origin を持ち、`main`を checkout した root と、`eng-42-login`の worktree。 */
function checkoutWithWorktree() {
	const root = tempDir("hf-root-");
	execFileSync("git", ["init", "-q", "-b", "main", root]);
	git(root, "remote", "add", "origin", "git@github.com:Acme/Web.git");
	git(root, "commit", "-q", "--allow-empty", "-m", "init");
	const worktree = join(root, ".worktrees", "eng-42-login");
	git(root, "worktree", "add", "-q", "-b", "eng-42-login", worktree);
	mkdirSync(join(worktree, "src"));
	return { root, worktree };
}

describe("observedDirectories", () => {
	const cwd = "/repo";

	it("uses the cwd at the end of a turn for both agents", () => {
		expect(observedDirectories("claude_code", "stop", {}, cwd)).toEqual([cwd]);
		expect(observedDirectories("codex", "stop", {}, cwd)).toEqual([cwd]);
	});

	it("uses the new cwd of Claude Code when it changes", () => {
		expect(
			observedDirectories(
				"claude_code",
				"cwd-changed",
				{ old_cwd: "/repo", new_cwd: "/repo/.worktrees/a" },
				cwd,
			),
		).toEqual(["/repo/.worktrees/a"]);
		expect(
			observedDirectories("claude_code", "cwd-changed", { new_cwd: "a" }, cwd),
		).toEqual([]);
	});

	it("uses the parent of the file that Claude Code wrote or edited", () => {
		for (const tool_name of ["Write", "Edit"])
			expect(
				observedDirectories(
					"claude_code",
					"post-tool-use",
					{ tool_name, tool_input: { file_path: "/w/src/a.ts", content: "x" } },
					cwd,
				),
			).toEqual(["/w/src"]);
		expect(
			observedDirectories(
				"claude_code",
				"post-tool-use",
				{ tool_name: "Bash", tool_input: { command: "cd /w" } },
				cwd,
			),
		).toEqual([]);
		expect(
			observedDirectories(
				"claude_code",
				"post-tool-use",
				{ tool_name: "Edit", tool_input: { file_path: "src/a.ts" } },
				cwd,
			),
		).toEqual([]);
	});

	it("uses the parents of the files named in a Codex patch, resolving relative paths from the cwd", () => {
		const command = [
			"*** Begin Patch",
			"*** Update File: src/a.ts",
			"@@",
			"-*** Add File: not/a/header.ts",
			"+x",
			"*** Move to: lib/b.ts",
			"*** Add File: /w/docs/c.md",
			"+y",
			"*** Delete File: src/d.ts",
			"*** End Patch",
		].join("\n");
		expect(
			observedDirectories(
				"codex",
				"post-tool-use",
				{ tool_name: "apply_patch", tool_input: { command } },
				cwd,
			),
		).toEqual(["/repo/src", "/repo/lib", "/w/docs"]);
		expect(
			observedDirectories(
				"codex",
				"post-tool-use",
				{ tool_name: "Bash", tool_input: { command } },
				cwd,
			),
		).toEqual([]);
	});
});

describe("observePair", () => {
	it("finds the repository and branch of the working tree that holds the directory", async () => {
		const { root, worktree } = checkoutWithWorktree();
		expect(await observePair(join(worktree, "src"), runGit)).toEqual({
			repository: "github.com/acme/web",
			branch: "eng-42-login",
		});
		expect(await observePair(root, runGit)).toEqual({
			repository: "github.com/acme/web",
			branch: "main",
		});
	});

	it("observes nothing outside git, on a detached HEAD, or in a missing directory", async () => {
		const { root } = checkoutWithWorktree();
		expect(await observePair(tempDir("hf-plain-"), runGit)).toBeUndefined();
		expect(await observePair(join(root, "missing"), runGit)).toBeUndefined();
		git(root, "checkout", "-q", "--detach");
		expect(await observePair(root, runGit)).toBeUndefined();
	});
});

describe("location state", () => {
	const pair = (branch: string) => ({
		repository: "github.com/acme/web",
		branch,
	});

	it("keeps at most ten distinct pairs", () => {
		let state = emptyLocationState();
		for (let i = 0; i < 12; i += 1)
			state = withObservedPair(state, pair(`b${i % 11}`));
		expect(state.pairs).toHaveLength(10);
		expect(withObservedPair(state, pair("b0")).pairs).toHaveLength(10);
	});

	it("sends only when the pairs differ from the pairs sent last", () => {
		const observed = withObservedPair(emptyLocationState(), pair("main"));
		expect(locationsToSend(observed)).toEqual([pair("main")]);
		expect(locationsToSend({ ...observed, sent: [pair("main")] })).toBe(
			undefined,
		);
		expect(
			locationsToSend({
				...observed,
				sent: [pair("main")],
				unauthorized: true,
			}),
		).toBe(undefined);
	});

	it("reads back what it wrote and treats a broken file as empty", async () => {
		const path = join(tempDir("hf-state-"), "locations-s.json");
		expect(await readLocationState(path)).toEqual(emptyLocationState());
		const state = withObservedPair(emptyLocationState(), pair("main"));
		await writeLocationState(path, state);
		expect(await readLocationState(path)).toEqual(state);
		writeFileSync(path, "{not json");
		expect(await readLocationState(path)).toEqual(emptyLocationState());
	});
});

describe.skipIf(process.platform === "win32")("codexLocationStatePath", () => {
	it("creates a private directory under the temporary directory", async () => {
		const tmp = tempDir("hf-tmp-");
		expect(await codexLocationStatePath(tmp, "s-1")).toBe(
			join(tmp, "harnessforce-locations", "codex-s-1.json"),
		);
	});

	it("refuses a directory that others can read and a symbolic link", async () => {
		const open = tempDir("hf-tmp-");
		mkdirSync(join(open, "harnessforce-locations"));
		chmodSync(join(open, "harnessforce-locations"), 0o755);
		expect(await codexLocationStatePath(open, "s-1")).toBeUndefined();
		const linked = tempDir("hf-tmp-");
		symlinkSync(tempDir("hf-target-"), join(linked, "harnessforce-locations"));
		expect(await codexLocationStatePath(linked, "s-1")).toBeUndefined();
	});

	it("refuses a session ID that could leave the directory", async () =>
		expect(
			await codexLocationStatePath(tempDir("hf-tmp-"), "../s"),
		).toBeUndefined());
});
