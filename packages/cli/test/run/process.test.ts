import { execFileSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import type { RunGit } from "@harnessforce/agent-core/process/git";
import { createGitRunner } from "@harnessforce/agent-core/process/git";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { describe, expect, it } from "vitest";
import { launchAgent } from "../../src/run/process.js";

// PATHを探さずに起動できるよう、agentは絶対pathで渡す。
const options = (env: Record<string, string> = {}) => ({
	platform: process.platform,
	env,
	cwd: process.cwd(),
	tmpDir: tempDir("hf-run-tmp-"),
});

describe("launchAgent", () => {
	it("runs the agent with the given environment and returns its exit code", async () => {
		const out = join(tempDir("hf-launch-"), "env.json");
		const outcome = await launchAgent(
			{
				command: process.execPath,
				args: [
					"-e",
					`require("node:fs").writeFileSync(${JSON.stringify(out)}, JSON.stringify({ issue: process.env.HARNESSFORCE_ISSUE, argv: process.argv.slice(1) })); process.exit(7)`,
					"a b",
				],
				env: { HARNESSFORCE_ISSUE: "ENG-42" },
			},
			options(),
		);
		expect(outcome).toEqual({ kind: "exited", code: 7 });
		expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({
			issue: "ENG-42",
			argv: ["a b"],
		});
	});

	// Windowsはsignalで終了したprocessをexit code 1として報告し、signalを渡さない。
	it.skipIf(process.platform === "win32")(
		"reports a signal as 128 plus its number",
		async () =>
			expect(
				await launchAgent(
					{
						command: process.execPath,
						args: ["-e", "process.kill(process.pid, 'SIGTERM')"],
						env: {},
					},
					options(),
				),
			).toEqual({ kind: "exited", code: 143 }),
	);

	it("fails when the arguments cannot be passed to a process", async () =>
		expect(
			await launchAgent(
				{
					command: process.execPath,
					args: ["a\u0000b"],
					env: {},
				},
				options(),
			),
		).toEqual({ kind: "failed" }));

	it("fails when the agent is not on PATH", async () =>
		expect(
			await launchAgent(
				{
					command: "hf-run-agent-that-does-not-exist",
					args: [],
					env: {},
				},
				options({ PATH: tempDir("hf-empty-path-") }),
			),
		).toEqual({ kind: "failed" }));
});

// agentとして起動し、受け取った引数と`--settings`のfileの状態を書き出すscript。
function recordingAgent() {
	const dir = tempDir("hf-agent-");
	const out = join(dir, "out.json");
	const agent = join(dir, "claude");
	writeFileSync(
		agent,
		`#!${process.execPath}
const fs = require("node:fs");
const argv = process.argv.slice(2);
const settings = argv[1];
fs.writeFileSync(${JSON.stringify(out)}, JSON.stringify({
	argv,
	mode: fs.statSync(settings).mode & 0o777,
	content: JSON.parse(fs.readFileSync(settings, "utf8")),
}));
`,
	);
	chmodSync(agent, 0o755);
	return {
		agent,
		dir,
		read: () => JSON.parse(readFileSync(out, "utf8")),
	};
}

describe.skipIf(process.platform === "win32")(
	"launchAgent with settings",
	() => {
		it("passes an absolute 0600 settings file before the args and deletes it after exit", async () => {
			const recorder = recordingAgent();
			const tmpDir = tempDir("hf-run-tmp-");
			const outcome = await launchAgent(
				{
					command: recorder.agent,
					args: ["-p", "hi"],
					env: {},
					settingsEnv: { HARNESSFORCE_ISSUE: "ENG-42" },
				},
				{ platform: process.platform, env: {}, cwd: recorder.dir, tmpDir },
			);
			expect(outcome).toEqual({ kind: "exited", code: 0 });
			const seen = recorder.read();
			expect(seen.argv[0]).toBe("--settings");
			expect(seen.argv[1]).toMatch(new RegExp(`^${tmpDir}/`));
			expect(seen.argv.slice(2)).toEqual(["-p", "hi"]);
			expect(seen.mode).toBe(0o600);
			expect(seen.content).toEqual({ env: { HARNESSFORCE_ISSUE: "ENG-42" } });
			expect(existsSync(seen.argv[1])).toBe(false);
			expect(readdirSync(tmpDir)).toEqual([]);
		});

		it("passes the settings file as an absolute path even from a relative temp directory", async () => {
			const recorder = recordingAgent();
			const tmpDir = relative(process.cwd(), tempDir("hf-run-tmp-"));
			expect(
				await launchAgent(
					{ command: recorder.agent, args: [], env: {}, settingsEnv: {} },
					{ platform: process.platform, env: {}, cwd: recorder.dir, tmpDir },
				),
			).toEqual({ kind: "exited", code: 0 });
			expect(isAbsolute(recorder.read().argv[1])).toBe(true);
		});

		it("resolves a bare command from PATH", async () => {
			const recorder = recordingAgent();
			const outcome = await launchAgent(
				{
					command: "claude",
					args: [],
					env: {},
					settingsEnv: {},
				},
				{
					platform: process.platform,
					env: { PATH: recorder.dir },
					cwd: tempDir("hf-cwd-"),
					tmpDir: tempDir("hf-run-tmp-"),
				},
			);
			expect(outcome).toEqual({ kind: "exited", code: 0 });
			expect(recorder.read().argv[0]).toBe("--settings");
		});

		it("fails without starting the agent when the settings file cannot be created", async () => {
			const recorder = recordingAgent();
			expect(
				await launchAgent(
					{
						command: recorder.agent,
						args: [],
						env: {},
						settingsEnv: {},
					},
					{
						platform: process.platform,
						env: {},
						cwd: recorder.dir,
						tmpDir: join(recorder.dir, "missing"),
					},
				),
			).toEqual({ kind: "failed" });
			expect(existsSync(join(recorder.dir, "out.json"))).toBe(false);
		});

		it("deletes the settings file when the agent cannot be started", async () => {
			const tmpDir = tempDir("hf-run-tmp-");
			const recorder = recordingAgent();
			expect(
				await launchAgent(
					{
						command: recorder.agent,
						args: ["a\u0000b"],
						env: {},
						settingsEnv: {},
					},
					{ platform: process.platform, env: {}, cwd: recorder.dir, tmpDir },
				),
			).toEqual({ kind: "failed" });
			expect(readdirSync(tmpDir)).toEqual([]);
		});
	},
);

describe("running git for hf run", () => {
	const runGit: RunGit = (cwd, args) =>
		createGitRunner({
			platform: process.platform,
			env: process.env,
			processCwd: process.cwd(),
			excludeTarget: false,
		})(cwd, args);

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
