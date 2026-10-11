// correlation.md「hookの警告」: hookが送れない状態を、利用者へ1行で伝える文言。文言にkey、path、host、session IDを含めない。
export const UNSUPPORTED_NODE_WARNING =
	"Harnessforceのhookには18以上のNode.jsが必要です";
export const RESTART_FAILED_WARNING =
	"Harnessforceのhookを起動し直せませんでした";
export const INVALID_ENDPOINT_WARNING =
	"Harnessforceの送信先が不正です。`harnessforce init`を実行し直してください";
export const REGISTRATION_FAILED_WARNING =
	"Harnessforceへのsession登録に失敗しました。通信を確かめてください";

// 送信が未設定のときの案内は、Claude Codeのpluginではsetup、Codexのhookではinitとする。
export const notConfiguredWarning = (agent: "claude_code" | "codex"): string =>
	agent === "claude_code"
		? "Harnessforceの送信が設定されていません。`/harnessforce:setup`を実行してください"
		: "Harnessforceの送信が設定されていません。`harnessforce init`を実行してください";

// session contextを出せない起動の失敗では、`systemMessage`だけのobjectを出す。
export const warningOnlyOutput = (message: string): string =>
	`${JSON.stringify({ systemMessage: message })}\n`;
