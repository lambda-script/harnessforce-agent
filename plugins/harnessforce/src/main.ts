import { homedir } from "node:os";
import { performance } from "node:perf_hooks";
import { managedDirFor } from "@harnessforce/agent-core/managed";
import { createGitRunner } from "@harnessforce/agent-core/process/git";
import {
	relaunchWithoutRuntimeVariables,
	spawnSelf,
} from "@harnessforce/agent-core/process/runtime-env";
import { runHook } from "./hook.js";
import { createUserKeyReader, execHf } from "./user-key.js";

// hookの取り除いた値を戻す子プロセスは無い。受け取った値は子へ渡さない（correlation.md「Node.jsの実行時の変数」）。
delete process.env.HARNESSFORCE_RUNTIME_ENV;

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString("utf8");
}

// 読み手が先に閉じても（EPIPE）、未処理の例外で0以外のexit codeにしない。hookは常にexit 0で終える。
for (const stream of [process.stdout, process.stderr])
	stream.on("error", () => {});

async function main(): Promise<void> {
	// stdinを読む前に確かめる。起動し直したprocessが同じstdinから入力を読む。
	const relaunch = await relaunchWithoutRuntimeVariables({
		platform: process.platform,
		env: process.env,
		stash: false,
		spawnSelf,
	});
	if (relaunch.kind === "failed")
		process.stderr.write(
			"harnessforce: session registration skipped (restart failed)\n",
		);
	if (relaunch.kind !== "not-needed") return;
	const raw = await readStdin().catch(() => "");
	await runHook(process.argv[2] ?? "", raw, {
		env: process.env,
		now: () => new Date(),
		// 実行時の変数を除くため起動し直した場合は、このprocessの開始から数える。差は予算の残りの0.5秒に収まる。
		processStartMs: performance.timeOrigin,
		git: createGitRunner({
			platform: process.platform,
			env: process.env,
			processCwd: process.cwd(),
			excludeTarget: true,
		}),
		fetch: (url, init) => fetch(url, init),
		stdout: (text) => process.stdout.write(text),
		stderr: (text) => process.stderr.write(text),
		homeDir: homedir(),
		managedDir: managedDirFor(process.platform),
		readUserKey: createUserKeyReader({
			platform: process.platform,
			env: process.env,
			exec: execHf,
			processCwd: process.cwd(),
		}),
	});
}

void main();
