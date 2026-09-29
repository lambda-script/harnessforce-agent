import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isObject } from "@harnessforce/agent-core/object";

// improvement-loop.md「端末の設定」: `~/.harnessforce/config.json`の`tune.send_report`。hfはこのfileを書かない。
export type SendSetting = "send" | "no_send" | "unreadable";

const tuneConfigPath = (homeDir: string) =>
	join(homeDir, ".harnessforce", "config.json");

const isMissing = (error: unknown) =>
	(error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";

// 送らない指示を読み損ねて送らないよう、読めない値は送らないものとする。
export async function readSendSetting(homeDir: string): Promise<SendSetting> {
	let text: string;
	try {
		text = await readFile(tuneConfigPath(homeDir), "utf8");
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
	if (!("tune" in value)) return "send";
	const { tune } = value;
	if (!isObject(tune)) return "unreadable";
	if (!("send_report" in tune)) return "send";
	const sendReport = tune.send_report;
	if (typeof sendReport !== "boolean") return "unreadable";
	return sendReport ? "send" : "no_send";
}
