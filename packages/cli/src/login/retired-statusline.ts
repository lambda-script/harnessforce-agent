import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isObject } from "@harnessforce/agent-core/object";
import {
	retiredStatusLineBackupFailedMessage,
	retiredStatusLineRemovedMessage,
	retiredStatusLineRestoredMessage,
} from "../shared/messages.js";

// correlation.md「CLI」の手順6「退役した利用枠のstatusLineの修復」。
// CLIの0.1系の`harnessforce usage-limits on`が元のstatusLineを包んで書いたcommandで、CLIが消えた後は何も表示しない。
const RETIRED_COMMAND_PREFIX = "harnessforce usage-limits";
// user settingsは他のsecret（apiKeyHelperなど）を持ちうるため、backupも所有者だけが読めるようにする。
const BACKUP_MODE = 0o600;

type Settings = Record<string, unknown>;

type StatusLineRepair = {
	settings: Settings;
	// 手順6の書き込みが成功した後に、手順8より前に出す1行。修復の対象でなければundefined。
	notice: string | undefined;
};

const usageLimitsDir = (homeDir: string) => join(homeDir, ".harnessforce");

export const hasRetiredStatusLine = (settings: Settings): boolean => {
	const { statusLine } = settings;
	return (
		isObject(statusLine) &&
		typeof statusLine.command === "string" &&
		statusLine.command.startsWith(RETIRED_COMMAND_PREFIX)
	);
};

// 例: 2026-11-02T03:04:05.678Z → "20261102T030405Z"
const backupTimestamp = (now: Date) =>
	`${now.toISOString().slice(0, 19).replaceAll(/[-:]/g, "")}Z`;

// `usage-limits on`が置き換える前のstatusLine。fileが無い、読めない、`original`がobjectでなければundefined。
async function readRecordedStatusLine(
	homeDir: string,
): Promise<Settings | undefined> {
	try {
		const mark: unknown = JSON.parse(
			await readFile(
				join(usageLimitsDir(homeDir), "usage-limits.json"),
				"utf8",
			),
		);
		return isObject(mark) && isObject(mark.original)
			? mark.original
			: undefined;
	} catch {
		return undefined;
	}
}

// 書き込む前のuser settingsのfileを写す。既存のfileを上書きしない。写せなければundefined。
async function backUp(
	settingsPath: string,
	now: Date,
): Promise<string | undefined> {
	const backupPath = `${settingsPath}.harnessforce-backup-${backupTimestamp(now)}`;
	try {
		await writeFile(backupPath, await readFile(settingsPath), {
			mode: BACKUP_MODE,
			flag: "wx",
		});
		return backupPath;
	} catch {
		return undefined;
	}
}

/**
 * statusLineが退役した`harnessforce usage-limits`のcommandなら、backupを写したうえで、記録された元のstatusLineへ戻すか、
 * 記録が無ければ鍵を消す。backupを写せなければstatusLineを変えない。それ以外のstatusLineには触れない。
 */
export async function repairRetiredStatusLine(
	settings: Settings,
	settingsPath: string,
	homeDir: string,
	now: Date,
): Promise<StatusLineRepair> {
	if (!hasRetiredStatusLine(settings)) return { settings, notice: undefined };
	const backupPath = await backUp(settingsPath, now);
	if (backupPath === undefined)
		return { settings, notice: retiredStatusLineBackupFailedMessage };
	const original = await readRecordedStatusLine(homeDir);
	if (original !== undefined)
		return {
			settings: { ...settings, statusLine: original },
			notice: retiredStatusLineRestoredMessage(backupPath),
		};
	const { statusLine: _retired, ...rest } = settings;
	return {
		settings: rest,
		notice: retiredStatusLineRemovedMessage(backupPath),
	};
}

// 退役した利用枠の同意の印と送信の記録。読むcommandが無いため消す。消せなくてもloginの結果を変えない。
export async function removeRetiredUsageLimitsFiles(
	homeDir: string,
): Promise<void> {
	await Promise.all(
		["usage-limits.json", "usage-limits-state.json"].map((name) =>
			rm(join(usageLimitsDir(homeDir), name), { force: true }).catch(
				() => undefined,
			),
		),
	);
}
