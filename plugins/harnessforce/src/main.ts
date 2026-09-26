import { execFile } from "node:child_process";
import { runHook } from "./hook.js";
import type { RunGit } from "./vcs.js";

// gitの各呼び出しの上限。repositoryの判定でsessionの開始を待たせない。
const GIT_TIMEOUT_MS = 1000;

const runGit: RunGit = (cwd, args) =>
	new Promise((resolve) => {
		execFile(
			"git",
			["-C", cwd, ...args],
			{ encoding: "utf8", timeout: GIT_TIMEOUT_MS, windowsHide: true },
			(error, stdout) =>
				resolve(error ? undefined : stdout.trim() || undefined),
		);
	});

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString("utf8");
}

void readStdin()
	.catch(() => "")
	.then((raw) =>
		runHook(process.argv[2] ?? "", raw, {
			env: process.env,
			now: () => new Date(),
			git: runGit,
			fetch: (url, init) => fetch(url, init),
			stdout: (text) => process.stdout.write(text),
			stderr: (text) => process.stderr.write(text),
		}),
	);
