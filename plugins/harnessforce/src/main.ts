import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { runHook } from "./hook.js";
import { managedDirFor } from "./managed.js";
import type { RunGit } from "./vcs.js";

// gitの各呼び出しの上限。repositoryの判定でsessionの開始を待たせない。
const GIT_TIMEOUT_MS = 1000;

// GIT_DIRなどが利用者の環境にあると、cwdではなくそのrepositoryを読むため、gitへは渡さない。
const gitEnv = Object.fromEntries(
	Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);

const runGit: RunGit = (cwd, args) =>
	new Promise((resolve) => {
		execFile(
			"git",
			["-C", cwd, ...args],
			{
				encoding: "utf8",
				env: gitEnv,
				timeout: GIT_TIMEOUT_MS,
				windowsHide: true,
			},
			(error, stdout) =>
				resolve(error ? undefined : stdout.trim() || undefined),
		);
	});

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString("utf8");
}

// 読み手が先に閉じても（EPIPE）、未処理の例外で0以外のexit codeにしない。hookは常にexit 0で終える。
for (const stream of [process.stdout, process.stderr])
	stream.on("error", () => {});

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
			homeDir: homedir(),
			managedDir: managedDirFor(process.platform),
		}),
	);
