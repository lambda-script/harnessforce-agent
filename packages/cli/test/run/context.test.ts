import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { snapshotId } from "../../src/config/canonical.js";
import { collectConfig } from "../../src/config/collect.js";
import { type RunGit, resolveLaunchContext } from "../../src/run/context.js";
import { tempDir, writeTree } from "../config/support.js";

type GitAnswers = Record<string, string | undefined>;

// `git -C <cwd> <args>`の代わり。args を空白で連結した鍵で答える。
function fakeGit(answers: GitAnswers) {
	const calls: { cwd: string; args: readonly string[] }[] = [];
	const git: RunGit = async (cwd, args) => {
		calls.push({ cwd, args });
		return answers[args.join(" ")];
	};
	return { git, calls };
}

function project() {
	const root = tempDir("hf-run-");
	const dirs = {
		repo: join(root, "repo"),
		home: join(root, "home"),
		managed: join(root, "managed"),
	};
	writeTree(dirs.repo, { ".claude/skills/review/SKILL.md": "# review\n" });
	writeTree(dirs.home, {});
	writeTree(dirs.managed, {});
	return dirs;
}

const insideRepo = (root: string): GitAnswers => ({
	"rev-parse --is-inside-work-tree": "true",
	"rev-parse --show-toplevel": root,
	remote: "upstream\norigin",
	"remote get-url origin": "git@github.com:Acme/Web.git",
	"symbolic-ref --quiet --short HEAD": "eng-42-login",
	"rev-parse --verify --quiet HEAD": "0123abc",
});

describe("resolveLaunchContext", () => {
	it("reads the VCS fields and the snapshot ID of the repository root", async () => {
		const dirs = project();
		const { git, calls } = fakeGit(insideRepo(dirs.repo));
		const options = {
			cwd: join(dirs.repo, "src"),
			git,
			homeDir: dirs.home,
			managedDir: dirs.managed,
			env: {},
			now: () => new Date(0),
		};
		const expected = await collectConfig({
			projectRoot: dirs.repo,
			homeDir: dirs.home,
			managedDir: dirs.managed,
			env: {},
			isExpired: () => false,
		});
		if (expected.kind !== "collected") throw new Error("fixture");
		expect(await resolveLaunchContext(options)).toEqual({
			repository: "github.com/acme/web",
			branch: "eng-42-login",
			commit: "0123abc",
			configVersion: snapshotId(expected.components),
		});
		expect(calls.every((call) => call.cwd === options.cwd)).toBe(true);
	});

	it("omits the branch on a detached HEAD and the repository for an unknown remote", async () => {
		const dirs = project();
		const { git } = fakeGit({
			...insideRepo(dirs.repo),
			"symbolic-ref --quiet --short HEAD": undefined,
			"remote get-url origin": "/srv/git/web.git",
		});
		const context = await resolveLaunchContext({
			cwd: dirs.repo,
			git,
			homeDir: dirs.home,
			managedDir: dirs.managed,
			env: {},
			now: () => new Date(0),
		});
		expect(context).not.toHaveProperty("branch");
		expect(context).not.toHaveProperty("repository");
		expect(context.commit).toBe("0123abc");
	});

	it("has no VCS fields outside a repository but still a snapshot ID of cwd", async () => {
		const dirs = project();
		const { git } = fakeGit({});
		const context = await resolveLaunchContext({
			cwd: dirs.repo,
			git,
			homeDir: dirs.home,
			managedDir: dirs.managed,
			env: {},
			now: () => new Date(0),
		});
		expect(Object.keys(context)).toEqual(["configVersion"]);
	});

	it("has no VCS fields in a repository without a remote", async () => {
		const dirs = project();
		const { git } = fakeGit({ ...insideRepo(dirs.repo), remote: undefined });
		const context = await resolveLaunchContext({
			cwd: dirs.repo,
			git,
			homeDir: dirs.home,
			managedDir: dirs.managed,
			env: {},
			now: () => new Date(0),
		});
		expect(Object.keys(context)).toEqual(["configVersion"]);
	});

	it("does not inject the config version without components", async () => {
		const dirs = project();
		const empty = tempDir("hf-empty-");
		const { git } = fakeGit({});
		const context = await resolveLaunchContext({
			cwd: empty,
			git,
			homeDir: dirs.home,
			managedDir: dirs.managed,
			env: {},
			now: () => new Date(0),
		});
		expect(context).toEqual({});
	});

	it("does not inject the config version when the collection runs past one second", async () => {
		const dirs = project();
		let ms = 0;
		// project rootを求める前に収集が始まり、gitの応答までに1秒を超える。
		const git: RunGit = async (_, args) => {
			if (args.join(" ") !== "rev-parse --show-toplevel") return undefined;
			ms += 1001;
			return dirs.repo;
		};
		const context = await resolveLaunchContext({
			cwd: dirs.repo,
			git,
			homeDir: dirs.home,
			managedDir: dirs.managed,
			env: {},
			now: () => new Date(ms),
		});
		expect(context).not.toHaveProperty("configVersion");
	});

	// Windowsのfile名は`:`を含めず、`a:b.md`と`a/b.md`の衝突を作れない。
	it.skipIf(process.platform === "win32")(
		"does not inject the config version for duplicate identifiers",
		async () => {
			const dirs = project();
			writeTree(dirs.repo, {
				".claude/agents/a/b.md": "x",
				".claude/agents/a:b.md": "y",
			});
			const { git } = fakeGit({});
			const context = await resolveLaunchContext({
				cwd: dirs.repo,
				git,
				homeDir: dirs.home,
				managedDir: dirs.managed,
				env: {},
				now: () => new Date(0),
			});
			expect(context).toEqual({});
		},
	);
});
