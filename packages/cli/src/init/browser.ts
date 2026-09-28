import { spawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import {
	findProgram,
	type LookupFileSystem,
} from "@harnessforce/agent-core/process/lookup";
import type { Env } from "@harnessforce/agent-core/types";

export type SpawnBrowser = (
	command: string,
	args: readonly string[],
	env: Record<string, string>,
) => EventEmitter & { unref(): void };

// 起動したまま終わらないopenerは、ブラウザを開けたものとして扱う。
const STILL_RUNNING_MS = 3000;

// shellを介さずに起動し、URLの&などをshellに解釈させない。
function openerFor(platform: NodeJS.Platform, url: string): [string, string[]] {
	if (platform === "darwin") return ["open", [url]];
	if (platform === "win32")
		return ["rundll32", ["url.dll,FileProtocolHandler", url]];
	return ["xdg-open", [url]];
}

const spawnOpener: SpawnBrowser = (command, args, env) =>
	spawn(command, args, { env, stdio: "ignore", windowsHide: true });

export type OpenBrowserOptions = {
	platform: NodeJS.Platform;
	env: Env;
	cwd: string;
	// 起動し直す前に取り除いた実行時の変数。ブラウザは利用者の環境のproxyやCAを必要としうる。
	restoredEnv: Record<string, string>;
	spawn?: SpawnBrowser;
	fs?: LookupFileSystem;
	stillRunningMs?: number;
};

export async function openBrowser(
	url: string,
	{
		platform,
		env,
		cwd,
		restoredEnv,
		spawn: spawnImpl = spawnOpener,
		fs,
		stillRunningMs = STILL_RUNNING_MS,
	}: OpenBrowserOptions,
): Promise<boolean> {
	const [name, args] = openerFor(platform, url);
	// correlation.md「commandの解決」: 現在のdirectoryとそのrepositoryに置かれたopenerを起動しない。
	const command = await findProgram(name, {
		platform,
		env,
		bases: [cwd],
		...(fs ? { fs } : {}),
	});
	if (command === undefined) return false;
	const childEnv = Object.fromEntries(
		Object.entries({ ...env, ...restoredEnv }).filter(
			(entry): entry is [string, string] => entry[1] !== undefined,
		),
	);
	return new Promise((resolve) => {
		const child = spawnImpl(command, args, childEnv);
		// ブラウザを前面で動かし続けるopenerでも、hfの終了を待たせない。
		child.unref();
		const timer = setTimeout(() => resolve(true), stillRunningMs);
		const finish = (opened: boolean) => {
			clearTimeout(timer);
			resolve(opened);
		};
		child.once("error", () => finish(false));
		child.once("exit", (code: number | null) => finish(code === 0));
	});
}
