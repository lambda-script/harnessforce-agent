import { randomUUID } from "node:crypto";
import {
	chmod,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { isObject } from "@harnessforce/agent-core/object";

// usage-limits.md「同意」の現行の文面の版。文面を変える版はこの値を上げる。
export const CURRENT_TEXT_VERSION = 1;

// 端末の同意の印と、送信の間隔の記録。利用者だけが読み書きできる。
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

export type UsageLimitsMark = {
	consented: boolean;
	text_version: number;
	// 組み込む前のstatusLine。無ければnull。
	original: Record<string, unknown> | null;
};

// 窓の長さ（分）ごとのresetの時刻（epochの秒）と、最後に送った時刻（epochのms）。
export type SendState = {
	sent_at: number;
	resets_at: Record<string, number>;
};

const markPath = (homeDir: string) =>
	join(homeDir, ".harnessforce", "usage-limits.json");
const statePath = (homeDir: string) =>
	join(homeDir, ".harnessforce", "usage-limits-state.json");

async function readJson(path: string): Promise<unknown> {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch {
		return undefined;
	}
}

// 読めない、または形の違うfileは、同意の印が無いものとして扱う。
export async function readMark(
	homeDir: string,
): Promise<UsageLimitsMark | undefined> {
	const value = await readJson(markPath(homeDir));
	if (!isObject(value)) return undefined;
	const { consented, text_version: textVersion, original } = value;
	if (
		typeof consented !== "boolean" ||
		typeof textVersion !== "number" ||
		!(original === null || isObject(original))
	)
		return undefined;
	return { consented, text_version: textVersion, original };
}

export async function readSendState(
	homeDir: string,
): Promise<SendState | undefined> {
	const value = await readJson(statePath(homeDir));
	if (!isObject(value) || typeof value.sent_at !== "number") return undefined;
	const resets = value.resets_at;
	if (!isObject(resets)) return undefined;
	const entries = Object.entries(resets);
	if (entries.some(([, at]) => typeof at !== "number")) return undefined;
	return {
		sent_at: value.sent_at,
		resets_at: Object.fromEntries(entries) as Record<string, number>,
	};
}

// 複数のstatusLineの実行が同時に書くため、一時fileへ書いてから置き換える。
async function writeOwnerOnly(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: DIRECTORY_MODE });
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(value)}\n`, {
			mode: FILE_MODE,
			flag: "wx",
		});
		await chmod(temporary, FILE_MODE);
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}

export const writeSendState = (homeDir: string, state: SendState) =>
	writeOwnerOnly(statePath(homeDir), state);

export const writeMark = (homeDir: string, mark: UsageLimitsMark) =>
	writeOwnerOnly(markPath(homeDir), mark);

// 同意の印と送信の記録を消す。無くても成功とする。
export async function removeMarkAndState(homeDir: string): Promise<void> {
	await rm(markPath(homeDir), { force: true });
	await rm(statePath(homeDir), { force: true });
}
