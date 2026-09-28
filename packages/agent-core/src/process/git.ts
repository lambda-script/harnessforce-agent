import { execFile } from "node:child_process";
import { type Env, findProgram, type LookupFileSystem } from "./lookup.js";

// gitが失敗、または出力が空ならundefinedを返す。
export type RunGit = (
	cwd: string,
	args: readonly string[],
) => Promise<string | undefined>;
export type ExecGit = (
	file: string,
	args: readonly string[],
	env: Record<string, string>,
	timeoutMs: number,
) => Promise<string | undefined>;

// gitの各呼び出しの上限。repositoryの判定でsessionの開始やagentの起動を待たせない。
const GIT_TIMEOUT_MS = 1000;

const execGit: ExecGit = (file, args, env, timeoutMs) =>
	new Promise((resolve) => {
		execFile(
			file,
			args,
			{ encoding: "utf8", env, timeout: timeoutMs, windowsHide: true },
			(error, stdout) =>
				resolve(error ? undefined : stdout.trim() || undefined),
		);
	});

type GitRunnerOptions = {
	platform: NodeJS.Platform;
	env: Env;
	processCwd: string;
	// hookは入力のcwd（`git -C`の対象）も除外の基点にする（correlation.md「commandの解決」）。
	excludeTarget: boolean;
	timeoutMs?: number;
	fs?: LookupFileSystem;
	exec?: ExecGit;
};

export function createGitRunner({
	platform,
	env,
	processCwd,
	excludeTarget,
	timeoutMs = GIT_TIMEOUT_MS,
	fs,
	exec = execGit,
}: GitRunnerOptions): RunGit {
	// GIT_DIRなどが環境にあると、cwdではなくそのrepositoryを読むため、gitへは渡さない。
	// Windowsの環境変数の名前は大文字と小文字を区別しない。
	const isGitVariable = (name: string) =>
		(platform === "win32" ? name.toUpperCase() : name).startsWith("GIT_");
	const gitEnv = Object.fromEntries(
		Object.entries(env).filter(
			(entry): entry is [string, string] =>
				entry[1] !== undefined && !isGitVariable(entry[0]),
		),
	);
	const resolved = new Map<string, Promise<string | undefined>>();
	const gitFor = (cwd: string) => {
		const bases = excludeTarget ? [processCwd, cwd] : [processCwd];
		const key = bases.join("\0");
		let file = resolved.get(key);
		if (!file) {
			file = findProgram("git", {
				platform,
				env,
				bases,
				...(fs ? { fs } : {}),
			});
			resolved.set(key, file);
		}
		return file;
	};
	return async (cwd, args) => {
		const file = await gitFor(cwd);
		return file === undefined
			? undefined
			: exec(file, ["-C", cwd, ...args], gitEnv, timeoutMs);
	};
}
