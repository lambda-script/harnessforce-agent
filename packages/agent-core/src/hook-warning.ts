// correlation.md「hookの警告」: hookが送れない状態を、利用者へ1行で伝える文言。文言にkey、path、host、session IDを含めない。
export const UNSUPPORTED_NODE_WARNING =
	"Harnessforce hooks require Node.js 18 or later";
export const RESTART_FAILED_WARNING = "Could not restart the Harnessforce hook";
export const INVALID_ENDPOINT_WARNING =
	"The Harnessforce destination is invalid. Run `harnessforce init` again";
export const REGISTRATION_FAILED_WARNING =
	"Harnessforce session registration failed. Check your network connection";

// 送信が未設定のときの案内は、Claude Codeのpluginではsetup、Codexのhookではinitとする。
export const notConfiguredWarning = (agent: "claude_code" | "codex"): string =>
	agent === "claude_code"
		? "Harnessforce sending is not configured. Run `/harnessforce:setup`"
		: "Harnessforce sending is not configured. Run `harnessforce init`";

// session contextを出せない起動の失敗では、`systemMessage`だけのobjectを出す。
export const warningOnlyOutput = (message: string): string =>
	`${JSON.stringify({ systemMessage: message })}\n`;
