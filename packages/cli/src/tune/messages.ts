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
		"`hf init`を実行してください。Viewerのロールでは`hf tune`を利用できません",
	invalidUrl: "接続先のURLが不正です",
	locked: "別の`hf tune`が実行中のため、実行できません",
	insufficient: (count: number) =>
		`データ不足: 分析したsessionは${count}件です。提案には${MINIMUM_SESSIONS}件以上が必要です（あと${MINIMUM_SESSIONS - count}件）`,
	outOfRange: (days: number, count: number) =>
		`送信の範囲外: 開始が${days}日より前の${count}件のsessionは送信しません`,
	notConnected: (count: number) =>
		`接続済みでないrepositoryの${count}件のsessionは送信しません`,
	partlyUnreadable: (lines: number, skipped: number) =>
		`記録の一部を読めていない: 読んだ${lines}行のうち${skipped}行を読み飛ばしました`,
	savedList: (fetchedAt: string) =>
		`接続済みのrepositoryの一覧を取得できないため、${fetchedAt}に保存した一覧を使います`,
	noList: "接続済みのrepositoryを確認できないため送信しません",
	noSend: "送信しない設定のため、分析結果を送信しません",
	settingUnreadable:
		"端末の設定（`~/.harnessforce/config.json`）を読めないため、分析結果を送信しません",
	importLimited: (count: number) =>
		`月間イベント数の上限または閲覧のみのため、${count}件のsessionを取り込めませんでした。分析結果は送信し、取り込みは解除の後の実行でやり直します`,
	importFailed:
		"送信の前のsessionの取り込みに失敗しました。分析結果は送信し、取り込みは次の実行でやり直します",
	sent: (count: number) => `${count}件の分析結果を送信しました`,
	unreachable: (count: number) =>
		`Harnessforceへ送信できませんでした。${count}件の分析結果は次の実行で送ります`,
	expiredUnsent: (count: number) =>
		`送信の範囲外になった未送信の分析結果${count}件を削除しました`,
	readOnly: (count: number) =>
		`Workspaceが閲覧のみのため、${count}件の分析結果を送信できませんでした。次の実行で送ります`,
	invalidReports: (count: number, reasons: readonly string[]) =>
		`形式が不正なため${count}件の分析結果を送信せずに削除しました（${reasons.join("、")}）`,
	rejected: (status: number, count: number) =>
		`Harnessforceが送信を拒否しました（HTTP ${status}）。${count}件の分析結果を送信せずに削除しました`,
	keyUnusable: (count: number) =>
		`送信キーを使えません。未送信の分析結果${count}件を削除しました。\`hf init\`を実行してください`,
	loginExpired: "ログインの有効期限が切れました。`hf init`を実行してください",
	unwritable:
		"`~/.harnessforce/tune/`に書き込めないため、分析結果を送信しません",
	recordFailed: "提案を記録できませんでした",
	recordInvalid: (field: string) => `提案の記録の入力が不正です: ${field}`,
	usage:
		"使い方: hf tune [--all] [--no-send] [--show-report] [--json] ｜ hf tune record ｜ hf tune --purge",
	purged:
		"`~/.harnessforce/tune/`の分析結果、提案、未送信の分析結果を削除しました",
	purgeFailed: "`~/.harnessforce/tune/`の一部のfileを削除できませんでした",
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
