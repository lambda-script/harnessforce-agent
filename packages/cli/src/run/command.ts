import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { posix, win32 } from "node:path";
import type { Env } from "../otel-headers.js";

// correlation.md「CLI」の`hf run`の手順7。agentのfileを解決し、起動するcommand lineを作る。
export type IsRunnable = (path: string) => Promise<boolean>;

export type ResolveOptions = {
	platform: NodeJS.Platform;
	env: Env;
	cwd: string;
	isRunnable?: IsRunnable;
};

export type CommandLine = { file: string; args: string[]; verbatim: boolean };

const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";
// cmd.exeは引用符の中でも%と!を展開し、"は引用を閉じ、改行はcommandを区切る。
const CMD_UNSAFE = /["%!\r\n]/;

const pathFor = (platform: NodeJS.Platform) =>
	platform === "win32" ? win32 : posix;

const hasSeparator = (command: string, platform: NodeJS.Platform) =>
	platform === "win32" ? /[\\/]/.test(command) : command.includes("/");

export async function resolveAgentFile(
	command: string,
	{ platform, env, cwd, isRunnable = isRunnableOn(platform) }: ResolveOptions,
): Promise<string | undefined> {
	const path = pathFor(platform);
	if (hasSeparator(command, platform)) {
		const file = path.resolve(cwd, command);
		return (await isRunnable(file)) ? file : undefined;
	}
	const extensions =
		platform === "win32"
			? (env.PATHEXT ?? DEFAULT_PATHEXT).split(";").filter(Boolean)
			: [""];
	// 相対pathのdirectoryはcwdで解決され、repositoryの中のfileを起動しうるため探さない（hookと同じ）。
	const dirs = (env.PATH ?? "")
		.split(path.delimiter)
		.filter((dir) => path.isAbsolute(dir));
	for (const dir of dirs)
		for (const extension of extensions) {
			const candidate = path.join(dir, `${command}${extension}`);
			if (await isRunnable(candidate)) return candidate;
		}
	return undefined;
}

// Node.jsは.cmdと.batをshellなしで起動するとEINVALで失敗するため、cmd.exeに渡す（nodejs.md）。
export function commandLine(
	file: string,
	args: readonly string[],
	{ platform, env }: { platform: NodeJS.Platform; env: Env },
): CommandLine | undefined {
	if (platform !== "win32" || !/\.(cmd|bat)$/i.test(file))
		return { file, args: [...args], verbatim: false };
	const words = [file, ...args];
	if (words.some((word) => CMD_UNSAFE.test(word))) return undefined;
	// /sは最初と最後の引用符を1組取り除くため、外側にもう1組付ける。
	const quoted = words.map((word) => `"${word}"`).join(" ");
	return {
		file: env.ComSpec ?? "cmd.exe",
		args: ["/d", "/s", "/c", `"${quoted}"`],
		verbatim: true,
	};
}

const isRunnableOn =
	(platform: NodeJS.Platform): IsRunnable =>
	async (path) => {
		try {
			if (!(await stat(path)).isFile()) return false;
			// WindowsにはPOSIXの実行権限が無く、拡張子で実行できるかが決まる。
			if (platform !== "win32") await access(path, constants.X_OK);
			return true;
		} catch {
			return false;
		}
	};
