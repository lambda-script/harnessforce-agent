import { spawn } from "node:child_process";
import type { EventEmitter } from "node:events";

export type SpawnBrowser = (
	command: string,
	args: readonly string[],
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

const spawnOpener: SpawnBrowser = (command, args) =>
	spawn(command, args, { stdio: "ignore", windowsHide: true });

export function openBrowser(
	url: string,
	platform: NodeJS.Platform,
	spawnImpl: SpawnBrowser = spawnOpener,
	stillRunningMs = STILL_RUNNING_MS,
): Promise<boolean> {
	const [command, args] = openerFor(platform, url);
	return new Promise((resolve) => {
		const child = spawnImpl(command, args);
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
