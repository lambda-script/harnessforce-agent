import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { posix, win32 } from "node:path";
import type { Env } from "./destination.js";

// `hf otel-headers`でkeychainの利用者用IngestKeyを読んだ結果（correlation.md「実行環境」）。
// missingは`hf`がPATHに無い場合、failedは`hf`があって読み出しに失敗した（keyが無い場合を含む）場合。
export type UserKeyRead =
	| { kind: "found"; key: string }
	| { kind: "missing" }
	| { kind: "failed" };

export type IsRunnable = (path: string) => Promise<boolean>;
// 終了コード0で上限時間内に終わったときだけokとする。
export type ExecHf = (
	file: string,
	args: readonly string[],
	options: { timeoutMs: number; windowsVerbatimArguments: boolean; env: Env },
) => Promise<{ ok: boolean; stdout: string }>;

// 送信の上限時間（2秒）とは別に数える起動の上限時間。
const HF_TIMEOUT_MS = 1000;
const HF_OUTPUT_LIMIT_BYTES = 64 * 1024;
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";
const BEARER = /^Bearer (\S+)$/;

type Command = { file: string; args: string[]; verbatim: boolean };

async function findHf(
	platform: NodeJS.Platform,
	env: Env,
	isRunnable: IsRunnable,
): Promise<string | undefined> {
	const path = platform === "win32" ? win32 : posix;
	const extensions =
		platform === "win32"
			? (env.PATHEXT ?? DEFAULT_PATHEXT).split(";").filter(Boolean)
			: [""];
	// 相対pathのdirectoryはhookのcwdで解決され、repositoryの中のfileを起動しうるため探さない。
	const dirs = (env.PATH ?? "")
		.split(path.delimiter)
		.filter((dir) => path.isAbsolute(dir));
	for (const dir of dirs)
		for (const extension of extensions) {
			const candidate = path.join(dir, `hf${extension}`);
			if (await isRunnable(candidate)) return candidate;
		}
	return undefined;
}

// Node.jsは.cmdと.batをshellなしで起動するとEINVALで失敗するため、cmd.exeに渡す（nodejs.md）。
function commandFor(file: string, env: Env): Command | undefined {
	if (!/\.(cmd|bat)$/i.test(file))
		return { file, args: ["otel-headers"], verbatim: false };
	// cmd.exeは引用符の中でも%を展開するため、起動しない。
	if (file.includes("%")) return undefined;
	return {
		file: env.ComSpec ?? "cmd.exe",
		// /sは最初と最後の引用符を1組取り除くため、外側にもう1組付ける。
		args: ["/d", "/s", "/c", `""${file}" otel-headers"`],
		verbatim: true,
	};
}

function parseKey(stdout: string): string | undefined {
	try {
		const value: unknown = JSON.parse(stdout);
		if (typeof value !== "object" || value === null || Array.isArray(value))
			return undefined;
		const authorization = (value as Record<string, unknown>).Authorization;
		return typeof authorization === "string"
			? BEARER.exec(authorization)?.[1]
			: undefined;
	} catch {
		return undefined;
	}
}

type ReaderOptions = {
	platform: NodeJS.Platform;
	env: Env;
	exec: ExecHf;
	isRunnable?: IsRunnable;
};

export function createUserKeyReader({
	platform,
	env,
	exec,
	isRunnable = isRunnableOn(platform),
}: ReaderOptions): () => Promise<UserKeyRead> {
	return async () => {
		const file = await findHf(platform, env, isRunnable);
		const command = file === undefined ? undefined : commandFor(file, env);
		if (!command) return { kind: "missing" };
		const result = await exec(command.file, command.args, {
			timeoutMs: HF_TIMEOUT_MS,
			windowsVerbatimArguments: command.verbatim,
			env,
		});
		const key = result.ok ? parseKey(result.stdout) : undefined;
		return key ? { kind: "found", key } : { kind: "failed" };
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

export const execHf: ExecHf = (file, args, options) =>
	new Promise((resolve) => {
		execFile(
			file,
			args,
			{
				encoding: "utf8",
				env: options.env,
				timeout: options.timeoutMs,
				killSignal: "SIGKILL",
				maxBuffer: HF_OUTPUT_LIMIT_BYTES,
				windowsHide: true,
				windowsVerbatimArguments: options.windowsVerbatimArguments,
			},
			(error, stdout) => resolve({ ok: !error, stdout }),
		);
	});
