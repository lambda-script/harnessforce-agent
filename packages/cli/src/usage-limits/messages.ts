// usage-limits.md「同意」の文面と、`harnessforce usage-limits`の終端の文言。
export const CONSENT_TEXT = {
	ja: "あなたの名前とともに、あなたの利用枠（5時間・7日などの窓の使用率とリセット時刻だけ）を、このWorkspaceのメンバー全員が見られます。プロンプトなどの本文は送りません。いつでもやめられ、やめると保存済みの値も削除します。メンバーの順位づけには使いません。",
	en: "Everyone in this workspace can see your usage limits together with your name (only the usage percentage and reset time of each window, such as 5 hours and 7 days). No prompt or other content is sent. You can stop at any time, and stopping deletes the stored values. They are not used to rank members.",
} as const;

export const CONSENT_PROMPT = {
	ja: "同意しますか? [y/N] ",
	en: "Do you agree? [y/N] ",
} as const;

export const MESSAGES = {
	windows: "この版のWindowsでは、利用枠の共有を設定できません",
	settingsUnreadable: "Claude Codeのuser settingsを読めません",
	statusLineUnsupported: "このstatusLineは組み込めません",
	noUserKey:
		"この端末には利用者用の送信キーがありません。`harnessforce init`を実行してください",
	keychainUnavailable:
		"OSのキーチェーンを利用できないため、利用枠の共有を設定できません",
	invalidUrl: "接続先のURLが不正です",
	loginExpired:
		"ログインの有効期限が切れました。`harnessforce init`をもう一度実行してください",
	notAgreed: "同意されなかったため、何も変えませんでした",
	invalidTextVersion:
		"このCLIの利用枠の文面が古いか新しすぎます。`harnessforce`を更新してください",
	viewer:
		"閲覧のみのロールでは、利用枠を共有できません。Workspaceの管理者に連絡してください",
	readOnly: "このWorkspaceは閲覧のみのため、利用枠の共有を設定できません",
	failed: "Harnessforceとの通信に失敗しました。もう一度お試しください",
	saveFailed:
		"端末の設定を書き込めなかったため、同意を取り消しました。もう一度お試しください",
	revokeFailedAfterSave:
		"端末の設定を書き込めず、同意の取り消しにも失敗しました。`harnessforce usage-limits status`で状態を確かめ、`harnessforce usage-limits off`を実行してください",
	notOptedIn:
		"同意を記録しました。Workspaceが利用枠の記録をopt-inするまで、値は保存されません",
	enabled:
		"利用枠の共有を有効にしました。Claude Codeを再起動すると反映されます",
	disabled: "利用枠の共有をやめ、保存済みの値の削除を依頼しました",
	revokedButNotRestored:
		"同意は撤回しましたが、statusLineを元に戻せませんでした。`harnessforce usage-limits off`をもう一度実行してください",
	usage:
		"Usage: harnessforce usage-limits on [--yes] | harnessforce usage-limits off | harnessforce usage-limits status | harnessforce usage-limits statusline\n",
} as const;

export const STATUS_LABELS = {
	consent: {
		shared: "同意している",
		notShared: "同意していない",
		outdated: "文面が古い",
		unknown: "確認できません",
	},
	optIn: { on: "有効", off: "無効", unknown: "確認できません" },
	statusLine: {
		embeddedWithOriginal: "組み込まれている（元のcommandあり）",
		embeddedWithoutOriginal: "組み込まれている（元のcommandなし）",
		notEmbedded: "組み込まれていない",
	},
} as const;
