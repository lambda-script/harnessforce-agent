import { execFile } from "node:child_process";
import {
	commandLineFor,
	findCommand,
	type LookupFileSystem,
} from "@harnessforce/agent-core/process/lookup";
import type { Env } from "./destination.js";

// `hf otel-headers`でkeychainの利用者用IngestKeyを読んだ結果（correlation.md「実行環境」）。
// missingは`hf`がPATHに無い場合、failedは`hf`があって読み出しに失敗した（keyが無い場合を含む）場合。
export type UserKeyRead =
	| { kind: "found"; key: string }
	| { kind: "missing" }
	| { kind: "failed" };

// 終了コード0で上限時間内に終わったときだけokとする。
export type ExecHf = (
	file: string,
	args: readonly string[],
	options: { timeoutMs: number; windowsVerbatimArguments: boolean; env: Env },
) => Promise<{ ok: boolean; stdout: string }>;

// 送信の上限時間（2秒）とは別に数える起動の上限時間。
const HF_TIMEOUT_MS = 1000;
const HF_OUTPUT_LIMIT_BYTES = 64 * 1024;
const BEARER = /^Bearer (\S+)$/;

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
	// hookのprocessの現在のdirectory。入力のcwdと並べて除外の基点にする（correlation.md「commandの解決」）。
	processCwd: string;
	fs?: LookupFileSystem;
};

export function createUserKeyReader({
	platform,
	env,
	exec,
	processCwd,
	fs,
}: ReaderOptions): (cwd: string) => Promise<UserKeyRead> {
	return async (cwd) => {
		const context = {
			platform,
			env,
			bases: [processCwd, cwd],
			...(fs ? { fs } : {}),
		};
		const file = await findCommand("hf", context);
		// 起動できない`.cmd`（pathが%や!を含む、nodeやcmd.exeが無い）は、hfがPATHに無い場合と同じに扱う。
		const command =
			file === undefined
				? undefined
				: await commandLineFor(file, ["otel-headers"], context, {
						quoteArgs: false,
					});
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
