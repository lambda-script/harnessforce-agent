import { INIT_MESSAGES } from "../shared/messages.js";

// correlation.md「CLIの宛先の決め方」「CLI」の`harnessforce run`が定める文言。
export const RUN_MESSAGES = {
	keychainUnavailable: INIT_MESSAGES.keychainUnavailable,
	initRequired: "`harnessforce init`を実行してください",
	invalidUrl: INIT_MESSAGES.invalidUrl,
	invalidIssue: "Issueの識別子が不正です",
	issueInitRequired:
		"Issueを解決できませんでした。`harnessforce init`を実行してください",
	loginExpired:
		"ログインの有効期限が切れました。`harnessforce init`を実行してください",
	issueFailed: "Issueを解決できず、候補も取得できませんでした",
	noMatch: "一致するIssueがありません",
	candidatesHeader: "Issueを解決できませんでした。候補:",
} as const;

export type RunMessage = keyof typeof RUN_MESSAGES;

export const launchFailedMessage = (agent: string) =>
	`${agent}を起動できませんでした`;
