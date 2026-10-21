// correlation.md「CLI」の`harnessforce init`、control-plane.md「IngestKey と ApiToken」、telemetry-pipeline.mdが定める文言。
export const INIT_MESSAGES = {
	success:
		"Connected to Harnessforce. Restart Claude Code to apply the settings",
	// client-updates.md「Claude Codeのplugin」: 自動更新を有効にしたことと、止める手段を示す。
	pluginAutoUpdateOn:
		"Automatic updates for the Harnessforce plugin are on. To turn them off, run `harnessforce init --no-plugin-auto-update` or use /plugin",
	invalidUrl: "The connection URL is invalid",
	keychainUnavailable:
		"The OS keychain is unavailable, so the ingest key cannot be saved",
	// Linuxで両方の保存先が使えなかったときだけ、keychainを使えない文言に続ける。
	linuxKeychainUnavailable:
		"Neither the Secret Service (GNOME Keyring or KWallet) nor the kernel keyring is available. In containers and CI, ask an Owner or Admin to distribute a Workspace ingest key through managed settings",
	waitingForSecretService:
		"Waiting for the Secret Service unlock prompt (up to 60 seconds)",
	savedToKernelKeyring:
		"The Secret Service is unavailable, so the ingest key was saved in the kernel keyring. It is lost on reboot or after a period of disuse. If it disappears, run `harnessforce init` again",
	tooManyKeys:
		"There are too many ingest keys in the keychain, so `harnessforce init` cannot run",
	tooManyCredentials:
		"There are too many ingest keys or login entries in the keychain, so `harnessforce init` cannot run",
	settingsUnreadable: "Cannot read the Claude Code user settings",
	network:
		"Communication with Harnessforce failed. Run `harnessforce init` again",
	listenFailed: "Could not start waiting for the login",
	timeout: "The login did not complete in time. Run `harnessforce init` again",
	accessDenied: "The login was denied",
	noWorkspace:
		"You are not a member of any Workspace. Create a Workspace or accept an invitation, then run `harnessforce init` again",
	loginFailed: "The login failed. Run `harnessforce init` again",
	viewer:
		"The view-only role cannot issue an ingest key. Contact a Workspace administrator",
	limitOwnerAdmin:
		"The number of active ingest keys has reached the limit. Revoke unused keys on the ingest keys page",
	limitMember:
		"The ingest key limit has been reached. Contact a Workspace administrator",
	gateUnavailable:
		"Could not apply the change on the receiving side. Nothing was changed. Try again",
	ingestUnavailable:
		"This environment does not receive telemetry, so an ingest key cannot be issued",
	saveFailed: "Could not save the ingest key. Run `harnessforce init` again",
	codexSaveFailed:
		"Could not write the Codex configuration. Run `harnessforce init` again",
	contentEnabled:
		"Sending the prompts you type is now enabled. Values that match known patterns for secrets and personal information are masked, but not everything can be detected. Within the workspace, only you can read your stored content, and it is deleted after the content retention period (at most 30 days)",
	contentNotOptedIn:
		"This workspace has not opted in to prompts you typed, so sending content was not enabled. Opt in under Data retention in the workspace settings, then run `harnessforce init --send-content` again",
} as const;

// 手順8: Codexの`config.toml`を書いた後の案内。trustは利用者の操作で、`harnessforce init`は代行できない。
export const codexNotes = (configPath: string) =>
	[
		`Wrote the Codex configuration (${configPath}). Restart Codex to apply it`,
		"Codex hooks do not run until you trust them in Codex's /hooks. Trust the harnessforce SessionStart, PostToolUse, and Stop hooks in /hooks",
		"To use the Harnessforce MCP server, log in with `codex mcp login harnessforce`",
	].join("\n");

export type InitMessage = keyof typeof INIT_MESSAGES;

// buildの既定以外の接続先へ向けたときに、利用者が気づくための1行。
export const nonDefaultConnectionMessage = (url: string) =>
	`Connecting to ${url} (not the default production endpoint)`;

// portを確保できなかったときの文言。既定の8080は一般的なHTTPのportで衝突しやすいため、
// 使えなかったportと`harnessforce init --port`の逃げ道を示す（correlation.md「CLI」）。
export const listenFailedMessage = (port: number) =>
	`${INIT_MESSAGES.listenFailed}. Stop the process using port ${port}, or specify another port with \`harnessforce init --port\``;

// keychainが使えるかを確かめて使えなかったときの文言。Linuxでは両方の保存先が使えない理由と逃げ道を続ける（correlation.md「実行環境」）。
export const keychainUnavailableMessage = (
	keychain: { unavailableHint?: string },
	message: string = INIT_MESSAGES.keychainUnavailable,
) =>
	keychain.unavailableHint
		? `${message}. ${keychain.unavailableHint}`
		: message;
