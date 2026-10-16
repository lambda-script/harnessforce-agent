// correlation.md「hookの警告」: hookが送れない状態を、利用者へ1行で伝える文言。文言にkey、path、host、session IDを含めない。
export const UNSUPPORTED_NODE_WARNING =
	"Harnessforce hooks require Node.js 18 or later";
export const RESTART_FAILED_WARNING = "Could not restart the Harnessforce hook";
export const INVALID_ENDPOINT_WARNING =
	"The Harnessforce destination is invalid. Run `harnessforce init` again";
export const REGISTRATION_FAILED_WARNING =
	"Harnessforce session registration failed. Check your network connection";

// 送信が未設定のときの案内は、Claude Codeのpluginではsetup、Codexのhookではinitとする。
export const notConfiguredWarning = (agent: Agent): string =>
	agent === "claude_code"
		? "Harnessforce sending is not configured. Run `/harnessforce:setup`"
		: "Harnessforce sending is not configured. Run `harnessforce init`";

type Agent = "claude_code" | "codex";

// correlation.md「送信の健全性」: Codexのテレメトリはconfig.tomlのkeyで送られ続け、止まるのは登録だけである。
const stopped = (agent: Agent) =>
	agent === "claude_code"
		? "telemetry is not being sent"
		: "sessions are not being registered";

export const keyMissingWarning = (agent: Agent): string =>
	`Harnessforce cannot find your ingest key, so ${stopped(agent)}. Run \`harnessforce init\``;

export const keyUnreadableWarning = (agent: Agent): string =>
	`Harnessforce could not read your ingest key from the OS keychain, so ${
		agent === "claude_code"
			? "telemetry may not be sent"
			: "sessions may not be registered"
	}. Unlock the keychain or run \`harnessforce init\``;

// Codexの送信先はrepositoryの.claude/settings.jsonに左右されないため、repositoryの設定を確かめる案内を含めない。
export const DESTINATION_MISMATCH_WARNING: Record<Agent, string> = {
	claude_code:
		"Telemetry is not being sent because the Harnessforce destination differs from the one saved by `harnessforce init`. Check this repository's settings or run `harnessforce init` again",
	codex:
		"Sessions are not being registered because the Harnessforce destination differs from the one saved by `harnessforce init`. Run `harnessforce init` again",
};

export const TELEMETRY_NOT_CONFIGURED_WARNING =
	"Claude Code telemetry for Harnessforce is not configured. Run `harnessforce init`";

// session contextを出せない起動の失敗では、`systemMessage`だけのobjectを出す。
export const warningOnlyOutput = (message: string): string =>
	`${JSON.stringify({ systemMessage: message })}\n`;
