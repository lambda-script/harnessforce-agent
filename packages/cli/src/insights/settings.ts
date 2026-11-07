import { readFile } from "node:fs/promises";
import { isObject } from "@harnessforce/agent-core/object";
import { deviceSettingsPath } from "../config/device-settings.js";

// improvement-loop.md「端末の設定」: `~/.harnessforce/config.json`の`insights.send_report`。この鍵は利用者が直接編集する。
export type SendSetting = "send" | "no_send" | "unreadable";

const isMissing = (error: unknown) =>
	(error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";

// 送らない指示を読み損ねて送らないよう、読めない値は送らないものとする。
export async function readSendSetting(homeDir: string): Promise<SendSetting> {
	let text: string;
	try {
		text = await readFile(deviceSettingsPath(homeDir), "utf8");
	} catch (error) {
		return isMissing(error) ? "send" : "unreadable";
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return "unreadable";
	}
	if (!isObject(value)) return "unreadable";
	if (!("insights" in value)) return "send";
	const { insights } = value;
	if (!isObject(insights)) return "unreadable";
	if (!("send_report" in insights)) return "send";
	const sendReport = insights.send_report;
	if (typeof sendReport !== "boolean") return "unreadable";
	return sendReport ? "send" : "no_send";
}
