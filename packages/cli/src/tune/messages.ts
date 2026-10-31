import { INIT_MESSAGES } from "../shared/messages.js";

// improvement-loop.md「文言と終了コード」。表の順に並べ、1回の実行で当たった行をこの順にすべて表示する。
const NOTICE_ORDER = [
	"insufficient",
	"outOfRange",
	"notConnected",
	"partlyUnreadable",
	"savedList",
	"noList",
	"noSend",
	"settingUnreadable",
	"importLimited",
	"importFailed",
	"sent",
	"unreachable",
	"expiredUnsent",
	"readOnly",
	"invalidReports",
	"rejected",
	"keyUnusable",
	"loginExpired",
	"unwritable",
] as const;
export type NoticeKey = (typeof NOTICE_ORDER)[number];

export const MINIMUM_SESSIONS = 10;

export const TUNE_MESSAGES = {
	keychainUnavailable: INIT_MESSAGES.keychainUnavailable,
	initRequired:
		"Run `harnessforce init`. The Viewer role cannot use `harnessforce tune`",
	invalidUrl: "The connection URL is invalid",
	locked: "Another `harnessforce tune` is running, so this run cannot start",
	insufficient: (count: number) =>
		`Not enough data: ${count} session(s) analyzed. Suggestions need at least ${MINIMUM_SESSIONS} (${MINIMUM_SESSIONS - count} more needed)`,
	outOfRange: (days: number, count: number) =>
		`Outside the sending range: ${count} session(s) that started more than ${days} days ago will not be sent`,
	notConnected: (count: number) =>
		`${count} session(s) in repositories that are not connected will not be sent`,
	partlyUnreadable: (lines: number, skipped: number) =>
		`Some records could not be read: skipped ${skipped} of ${lines} lines read`,
	savedList: (fetchedAt: string) =>
		`Could not fetch the list of connected repositories, so the list saved at ${fetchedAt} is used`,
	noList: "Could not verify the connected repositories, so nothing is sent",
	noSend: "Sending is turned off, so the analysis results are not sent",
	settingUnreadable:
		"Cannot read the device settings (`~/.harnessforce/config.json`), so the analysis results are not sent",
	importLimited: (count: number) =>
		`Could not import ${count} session(s) because of the monthly event limit or view-only mode. The analysis results are sent; importing is retried in a run after the restriction is lifted`,
	importFailed:
		"Importing sessions before sending failed. The analysis results are sent; importing is retried in the next run",
	sent: (count: number) => `Sent ${count} analysis result(s)`,
	unreachable: (count: number) =>
		`Could not send to Harnessforce. ${count} analysis result(s) will be sent in the next run`,
	expiredUnsent: (count: number) =>
		`Deleted ${count} unsent analysis result(s) that fell outside the sending range`,
	readOnly: (count: number) =>
		`Could not send ${count} analysis result(s) because the Workspace is view-only. They will be sent in the next run`,
	invalidReports: (count: number, reasons: readonly string[]) =>
		`Deleted ${count} analysis result(s) without sending because their format is invalid (${reasons.join(", ")})`,
	rejected: (status: number, count: number) =>
		`Harnessforce rejected the submission (HTTP ${status}). Deleted ${count} analysis result(s) without sending`,
	keyUnusable: (count: number) =>
		`The ingest key cannot be used. Deleted ${count} unsent analysis result(s). Run \`harnessforce init\``,
	loginExpired: "Your login has expired. Run `harnessforce init`",
	unwritable:
		"Cannot write to `~/.harnessforce/tune/`, so the analysis results are not sent",
	recordFailed: "Could not record the suggestion",
	recordInvalid: (field: string) =>
		`The suggestion record input is invalid: ${field}`,
	usage:
		"Usage: harnessforce tune [--all] [--no-send] [--show-report] [--json], harnessforce tune --report-only [--all], harnessforce tune --print-schedule, harnessforce tune record, or harnessforce tune --purge",
	purged:
		"Deleted the analysis results, suggestions and unsent analysis results in `~/.harnessforce/tune/`",
	purgeFailed: "Could not delete some files in `~/.harnessforce/tune/`",
} as const;

// 1回の実行で当たった行。同じ行に複数回当たったら、後の値で置き換える（件数は呼び出し側が合計する）。
export class Notices {
	private readonly entries = new Map<
		NoticeKey,
		{ text: string; code: number }
	>();

	add(key: NoticeKey, text: string, code = 0): void {
		this.entries.set(key, { text, code });
	}

	has(key: NoticeKey): boolean {
		return this.entries.has(key);
	}

	// 表の順の文言と、当たった行の終了コードの最大値。
	flush(stderr: (text: string) => void): number {
		let code = 0;
		for (const key of NOTICE_ORDER) {
			const entry = this.entries.get(key);
			if (!entry) continue;
			stderr(`${entry.text}\n`);
			code = Math.max(code, entry.code);
		}
		return code;
	}
}
