import { describe, expect, it } from "vitest";
import { createGitRunner, type ExecGit } from "../../src/process/git.js";
import type { LookupFileSystem } from "../../src/process/lookup.js";

const fsWith = (
	files: string[],
	gitMarkers: string[] = [],
): LookupFileSystem => ({
	isFile: async (path) => files.includes(path),
	isExecutable: async () => true,
	exists: async (path) => gitMarkers.includes(path),
	readSmallText: async () => undefined,
	readHead: async () => undefined,
});

function recordingExec(stdout: string | undefined) {
	const calls: {
		file: string;
		args: readonly string[];
		env: object;
		timeoutMs?: number;
	}[] = [];
	const exec: ExecGit = async (file, args, env, timeoutMs) => {
		calls.push({
			file,
			args,
			env,
			...(timeoutMs === 1000 ? {} : { timeoutMs }),
		});
		return stdout;
	};
	return { exec, calls };
}

describe("running git", () => {
	it("runs git by its absolute path outside the current directory's repository", async () => {
		const { exec, calls } = recordingExec("true");
		const git = createGitRunner({
			platform: "darwin",
			env: { PATH: "/repo/bin:/usr/bin", GIT_DIR: "/elsewhere", HOME: "/h" },
			processCwd: "/repo/sub",
			excludeTarget: false,
			fs: fsWith(["/repo/bin/git", "/usr/bin/git"], ["/repo/.git"]),
			exec,
		});
		expect(await git("/work/web", ["rev-parse", "--is-inside-work-tree"])).toBe(
			"true",
		);
		expect(calls).toEqual([
			{
				file: "/usr/bin/git",
				args: ["-C", "/work/web", "rev-parse", "--is-inside-work-tree"],
				// GIT_DIRなどがあると、cwdではなくそのrepositoryを読む。
				env: { PATH: "/repo/bin:/usr/bin", HOME: "/h" },
			},
		]);
	});

	it("uses the given time limit", async () => {
		const { exec, calls } = recordingExec("x");
		const git = createGitRunner({
			platform: "linux",
			env: { PATH: "/usr/bin" },
			processCwd: "/",
			excludeTarget: false,
			timeoutMs: 5000,
			fs: fsWith(["/usr/bin/git"]),
			exec,
		});
		await git("/work", ["remote"]);
		expect(calls[0]?.timeoutMs).toBe(5000);
	});

	it("also excludes the target directory for the hook", async () => {
		const { exec, calls } = recordingExec("x");
		const git = createGitRunner({
			platform: "linux",
			env: { PATH: "/work/web/tools:/usr/bin" },
			processCwd: "/",
			excludeTarget: true,
			fs: fsWith(["/work/web/tools/git", "/usr/bin/git"], ["/work/web/.git"]),
			exec,
		});
		await git("/work/web", ["remote"]);
		expect(calls.map((call) => call.file)).toEqual(["/usr/bin/git"]);
	});

	it("drops GIT_ variables in any case on Windows", async () => {
		const { exec, calls } = recordingExec("x");
		const git = createGitRunner({
			platform: "win32",
			env: { Path: "C:\\Git\\cmd", git_dir: "C:\\x", PATHEXT: ".EXE" },
			processCwd: "C:\\work",
			excludeTarget: false,
			fs: fsWith(["C:\\Git\\cmd\\git.EXE"]),
			exec,
		});
		await git("C:\\work", ["remote"]);
		expect(calls[0]?.env).toEqual({ Path: "C:\\Git\\cmd", PATHEXT: ".EXE" });
	});

	it.each([
		["git is missing", []],
		["git is only a batch file", ["C:\\Git\\git.cmd"]],
	])("fails without starting anything when %s", async (_name, files) => {
		const { exec, calls } = recordingExec("x");
		const git = createGitRunner({
			platform: "win32",
			env: { PATH: "C:\\Git", PATHEXT: ".CMD" },
			processCwd: "C:\\work",
			excludeTarget: false,
			fs: fsWith(files),
			exec,
		});
		expect(await git("C:\\work", ["remote"])).toBeUndefined();
		expect(calls).toEqual([]);
	});

	it("runs a real git found on PATH", async () => {
		const git = createGitRunner({
			platform: process.platform,
			env: { PATH: process.env.PATH ?? "" },
			processCwd: "/nonexistent-cwd",
			excludeTarget: false,
		});
		expect(await git(process.cwd(), ["--version"])).toMatch(/^git version /);
	});
});
