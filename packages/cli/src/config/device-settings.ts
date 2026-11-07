import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isObject } from "@harnessforce/agent-core/object";
import { ensureDir, writeJsonFile } from "../insights/store.js";

// correlation.md「端末の本文の送信の設定」とimprovement-loop.md「端末の設定」が使う端末の設定のfile。
export const deviceSettingsPath = (homeDir: string) =>
	join(homeDir, ".harnessforce", "config.json");

const isMissing = (error: unknown) =>
	(error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";

type DeviceSettings =
	| { kind: "ok"; value: Record<string, unknown> }
	| { kind: "unreadable" };

// fileが無ければ空のobject。読めない、JSONのobjectでないfileはunreadable。
async function readDeviceSettings(homeDir: string): Promise<DeviceSettings> {
	let text: string;
	try {
		text = await readFile(deviceSettingsPath(homeDir), "utf8");
	} catch (error) {
		return isMissing(error)
			? { kind: "ok", value: {} }
			: { kind: "unreadable" };
	}
	try {
		const value: unknown = JSON.parse(text);
		return isObject(value) ? { kind: "ok", value } : { kind: "unreadable" };
	} catch {
		return { kind: "unreadable" };
	}
}

// `send_content`が無ければ送らない。真偽値でない値は、送らない指示を読み損ねて送らないよう読めないものとする。
export async function readSendContent(
	homeDir: string,
): Promise<boolean | "unreadable"> {
	const settings = await readDeviceSettings(homeDir);
	if (settings.kind === "unreadable") return "unreadable";
	if (!("send_content" in settings.value)) return false;
	const sendContent = settings.value.send_content;
	return typeof sendContent === "boolean" ? sendContent : "unreadable";
}

// 他の鍵は残して`send_content`だけを書き換える。
export async function writeSendContent(
	homeDir: string,
	sendContent: boolean,
): Promise<"ok" | "unreadable" | "writeFailed"> {
	const settings = await readDeviceSettings(homeDir);
	if (settings.kind === "unreadable") return "unreadable";
	const path = deviceSettingsPath(homeDir);
	try {
		await ensureDir(dirname(path));
		await writeJsonFile(path, { ...settings.value, send_content: sendContent });
		return "ok";
	} catch {
		return "writeFailed";
	}
}
