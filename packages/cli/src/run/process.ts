import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { constants } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import type { Env } from "../otel-headers.js";
import { type CommandLine, commandLine, resolveAgentFile } from "./command.js";
import type { Launch } from "./launch.js";
import type { LaunchOutcome } from "./run.js";

// 端末からのCtrl-Cはagentも受け取る。agentが扱うため、hfは終わらずにagentの終了を待つ。
const IGNORED_WHILE_RUNNING = ["SIGINT", "SIGQUIT"] as const;
// hfだけに届いた終了の要求はagentへ渡す。
const FORWARDED = ["SIGTERM", "SIGHUP"] as const;

export type LaunchOptions = {
	platform: NodeJS.Platform;
	// PATH、PATHEXT、ComSpecを読む環境。子プロセスの環境と同じshellの環境。
	env: Env;
	cwd: string;
	tmpDir: string;
};

const FAILED: LaunchOutcome = { kind: "failed" };

// correlation.md「CLI」の`hf run`の手順4、7、8。
export async function launchAgent(
	launch: Launch,
	options: LaunchOptions,
): Promise<LaunchOutcome> {
	const file = await resolveAgentFile(launch.command, options);
	if (!file) return FAILED;
	if (!launch.settingsEnv) {
		const command = await commandLine(file, launch.args, options);
		return command ? spawnAndWait(command, launch.env) : FAILED;
	}
	// JSONを引数に直接置かず、利用者だけが読めるfileで渡す。fileを作れなければ起動しない。
	// `--settings`には絶対pathを渡す。TMPDIRが相対pathでもcwdに依らず同じfileを指す。
	const dir = await mkdtemp(join(resolvePath(options.tmpDir), "hf-run-")).catch(
		() => undefined,
	);
	if (!dir) return FAILED;
	try {
		const settingsPath = join(dir, "settings.json");
		await writeFile(settingsPath, JSON.stringify({ env: launch.settingsEnv }), {
			mode: 0o600,
			flag: "wx",
		});
		const command = await commandLine(
			file,
			["--settings", settingsPath, ...launch.args],
			options,
		);
		return command ? await spawnAndWait(command, launch.env) : FAILED;
	} catch {
		return FAILED;
	} finally {
		// 削除できなくても（Windowsで子孫がfileを開いたままなど）agentの終了コードで終わる。fileは秘密を含まない。
		await rm(dir, { recursive: true, force: true }).catch(() => {});
	}
}

function spawnAndWait(
	command: CommandLine,
	env: Record<string, string>,
): Promise<LaunchOutcome> {
	return new Promise((resolve) => {
		let child: ChildProcess;
		try {
			child = spawn(command.file, command.args, {
				env,
				stdio: "inherit",
				windowsVerbatimArguments: command.verbatim,
			});
		} catch {
			// NULを含む引数などはspawnが同期的に拒否する。
			return resolve(FAILED);
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
		child.once("error", () => finish(FAILED));
		child.once("exit", (code, signal) =>
			finish({
				kind: "exited",
				code: code ?? 128 + (signal ? constants.signals[signal] : 0),
			}),
		);
	});
}
