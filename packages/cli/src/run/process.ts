import { type ChildProcess, execFile, spawn } from "node:child_process";
import { constants } from "node:os";
import type { RunGit } from "./context.js";
import type { Launch } from "./launch.js";
import type { LaunchOutcome } from "./run.js";

// gitの各呼び出しの上限。pluginのhookと同じ値で、agentの起動を待たせない。
const GIT_TIMEOUT_MS = 1000;
// 端末からのCtrl-Cはagentも受け取る。agentが扱うため、hfは終わらずにagentの終了を待つ。
const IGNORED_WHILE_RUNNING = ["SIGINT", "SIGQUIT"] as const;
// hfだけに届いた終了の要求はagentへ渡す。
const FORWARDED = ["SIGTERM", "SIGHUP"] as const;

export const runGit: RunGit = (cwd, args) =>
	new Promise((resolve) => {
		// GIT_DIRなどが環境にあると、cwdではなくそのrepositoryを読むため、gitへは渡さない。
		const env = Object.fromEntries(
			Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
		);
		execFile(
			"git",
			["-C", cwd, ...args],
			{ encoding: "utf8", env, timeout: GIT_TIMEOUT_MS, windowsHide: true },
			(error, stdout) =>
				resolve(error ? undefined : stdout.trim() || undefined),
		);
	});

export function launchAgent(launch: Launch): Promise<LaunchOutcome> {
	return new Promise((resolve) => {
		let child: ChildProcess;
		try {
			child = spawn(launch.command, launch.args, {
				env: launch.env,
				stdio: "inherit",
			});
		} catch {
			// NULを含む引数などはspawnが同期的に拒否する。
			return resolve({ kind: "failed" });
		}
		const ignore = () => {};
		const forward = (signal: NodeJS.Signals) => child.kill(signal);
		for (const signal of IGNORED_WHILE_RUNNING) process.on(signal, ignore);
		for (const signal of FORWARDED) process.on(signal, forward);
		const finish = (outcome: LaunchOutcome) => {
			for (const signal of IGNORED_WHILE_RUNNING) process.off(signal, ignore);
			for (const signal of FORWARDED) process.off(signal, forward);
			resolve(outcome);
		};
		child.once("error", () => finish({ kind: "failed" }));
		child.once("exit", (code, signal) =>
			finish({
				kind: "exited",
				code: code ?? 128 + (signal ? constants.signals[signal] : 0),
			}),
		);
	});
}
