import type { ContentSettings } from "./login-settings.js";

// correlation.md「CLI」の確かめる順の終端。ログインしていないことと接続先の違いを別の文言にし、何をすべきかを分ける。
export const NOT_LOGGED_IN_MESSAGE =
	"You are not logged in to Harnessforce. Run `harnessforce login`";
export const DESTINATION_MISMATCH_MESSAGE =
	"The Harnessforce destination differs from the one saved by `harnessforce login`. Run `harnessforce login` again";

// correlation.md「CLI」の`harnessforce login`、control-plane.md「IngestKey と ApiToken」、telemetry-pipeline.mdが定める文言。
export const LOGIN_MESSAGES = {
	success:
		"Connected to Harnessforce. Restart Claude Code to apply the settings",
	// 手順8の最後の行。成功の後に利用者が次に打つcommandを1つだけ示す。
	next: "Next: run `harnessforce import` to send your past sessions",
	// 手順2: ブラウザが開いたかによらず、何を待っているか、どこで操作するか、いつまで待つか、どう止めるかを示す。
	opening:
		"Opening the Harnessforce login page in your browser. If it does not open, visit this URL:",
	waiting:
		"Waiting for you to log in (up to 5 minutes). Press Ctrl+C to cancel.",
	browserFailed: "Could not open a browser. Open the URL above to log in.",
	deviceSettingsUnreadable:
		"Cannot read the device settings (`~/.harnessforce/config.json`), so content is not sent",
	// client-updates.md「Claude Codeのplugin」: 自動更新を有効にしたことと、止める手段を示す。
	pluginAutoUpdateOn:
		"Automatic updates for the Harnessforce plugin are on. To turn them off, run `harnessforce login --no-plugin-auto-update` or use /plugin",
	invalidUrl: "The connection URL is invalid",
	keychainUnavailable:
		"The OS keychain is unavailable, so the ingest key cannot be saved",
	// Linuxで両方の保存先が使えなかったときだけ、keychainを使えない文言に続ける。
	linuxKeychainUnavailable:
		"Neither the Secret Service (GNOME Keyring or KWallet) nor the kernel keyring is available. In containers and CI, ask an Owner or Admin to distribute a Workspace ingest key through managed settings",
	waitingForSecretService:
		"Waiting for the Secret Service unlock prompt (up to 60 seconds)",
	savedToKernelKeyring:
		"The Secret Service is unavailable, so the ingest key was saved in the kernel keyring. It is lost on reboot or after a period of disuse. If it disappears, run `harnessforce login` again",
	tooManyKeys:
		"There are too many ingest keys in the keychain, so `harnessforce login` cannot run",
	tooManyCredentials:
		"There are too many ingest keys or login entries in the keychain, so `harnessforce login` cannot run",
	settingsUnreadable: "Cannot read the Claude Code user settings",
	network:
		"Communication with Harnessforce failed. Run `harnessforce login` again",
	listenFailed: "Could not start waiting for the login",
	timeout: "The login did not complete in time. Run `harnessforce login` again",
	accessDenied: "The login was denied",
	noWorkspace:
		"You are not a member of any Workspace. Create a Workspace or accept an invitation, then run `harnessforce login` again",
	loginFailed: "The login failed. Run `harnessforce login` again",
	viewer:
		"The view-only role cannot issue an ingest key. Contact a Workspace administrator",
	limitOwnerAdmin:
		"The number of active ingest keys has reached the limit. Ask members to revoke unused keys in My ingest keys on their account page",
	limitMember:
		"The ingest key limit has been reached. Contact a Workspace administrator",
	gateUnavailable:
		"Could not apply the change on the receiving side. Nothing was changed. Try again",
	saveFailed: "Could not save the ingest key. Run `harnessforce login` again",
	codexSaveFailed:
		"Could not write the Codex configuration. Run `harnessforce login` again",
	contentNotStored:
		"This workspace does not store content, so sending content was not enabled. An owner or admin can turn it on under Collection & retention in the workspace settings, then run `harnessforce config set send-content on` again",
	contentNotSent:
		"Content is not sent from this machine. Run `harnessforce config set send-content on` to send it",
} as const;

// 手順8: Codexの`config.toml`を書いた後の案内。trustは利用者の操作で、`harnessforce login`は代行できない。
// KWalletは解錠の確認を1つずつ順に出すため、前の確認が他のwindowの後ろで答えられずに残ると、loginの確認は表示されない。
export const kwalletUnlockHint = (walletLabel = "kdewallet") =>
	`KWallet asks for the password of the wallet "${walletLabel}" in a "KDE Wallet Service" window. If no window appears, an earlier request may be waiting behind other windows: answer that window, or log out and back in, then run \`harnessforce login\` again`;

export const codexNotes = (configPath: string) =>
	[
		`Wrote the Codex configuration (${configPath}). Restart Codex to apply it`,
		"Codex hooks do not run until you trust them in Codex's /hooks. Trust the harnessforce SessionStart, PostToolUse, and Stop hooks in /hooks",
		"To use the Harnessforce MCP server, log in with `codex mcp login harnessforce`",
	].join("\n");

export type LoginMessage = keyof typeof LOGIN_MESSAGES;

// correlation.md「CLI」の手順6「退役した利用枠のstatusLineの修復」の1行。
export const retiredStatusLineRestoredMessage = (backupPath: string) =>
	`Restored the Claude Code status line that the retired \`harnessforce usage-limits\` command had replaced. The previous settings are backed up at ${backupPath}`;
export const retiredStatusLineRemovedMessage = (backupPath: string) =>
	`Removed the Claude Code status line of the retired \`harnessforce usage-limits\` command because the status line it replaced was not recorded. The previous settings are backed up at ${backupPath}`;
export const retiredStatusLineBackupFailedMessage =
	"Could not back up the Claude Code user settings, so the status line left by the retired `harnessforce usage-limits` command was not changed. Run `harnessforce login` again to retry";

// correlation.md「CLI」の手順8: 割り当てたrepositoryが無い間の最後の行。手順2か3の画面のURLが分からなければ場所だけを示す。
export const assignRepositoriesNextMessage = (url: string | undefined) =>
	`Next: once repositories are assigned to a project ${url === undefined ? "in Harnessforce" : `at ${url}`}, run \`harnessforce import\` to send your past sessions`;

// buildの既定以外の接続先へ向けたときに、利用者が気づくための1行。
export const nonDefaultConnectionMessage = (url: string) =>
	`Connecting to ${url} (not the default production endpoint)`;

// portを確保できなかったときの文言。既定の8080は一般的なHTTPのportで衝突しやすいため、
// 使えなかったportと`harnessforce login --port`の逃げ道を示す（correlation.md「CLI」）。
export const listenFailedMessage = (port: number) =>
	`${LOGIN_MESSAGES.listenFailed}. Stop the process using port ${port}, or specify another port with \`harnessforce login --port\``;

// keychainが使えるかを確かめて使えなかったときの文言。Linuxでは両方の保存先が使えない理由と逃げ道を続ける（correlation.md「実行環境」）。
export const keychainUnavailableMessage = (
	keychain: { unavailableHint?: string },
	message: string = LOGIN_MESSAGES.keychainUnavailable,
) =>
	keychain.unavailableHint
		? `${message}. ${keychain.unavailableHint}`
		: message;

const CONTENT_READERS = {
	all_members: "Everyone in the workspace can read it",
	owners_admins_and_sender: "Owners, admins and you can read it",
	sender_only: "Within the workspace, only you can read it",
} as const;

// correlation.md「端末の本文の送信の設定」の「`on`を適用した」: `1`にした区分、読める人、保持期間を示す。
export function contentEnabledMessage(content: ContentSettings): string {
	const categories = [
		...(content.isPromptsStored ? ["the prompts you type"] : []),
		...(content.isModelAndToolsStored
			? ["model responses and tool input and output"]
			: []),
	].join(", ");
	return `Sending ${categories} is now enabled. Values that match known patterns for secrets and personal information are masked, but not everything can be detected. ${CONTENT_READERS[content.visibility]}. It is deleted after ${content.retentionDays} days. To stop sending it, run \`harnessforce config set send-content off\`.`;
}

// correlation.md「端末の本文の送信の設定」が定める文言。
export const CONFIG_MESSAGES = {
	usage:
		"Usage: harnessforce config get send-content, or harnessforce config set send-content on|off",
	notChanged:
		"Cannot read the device settings (`~/.harnessforce/config.json`), so the setting was not changed",
	saveFailed: "Could not save the device settings",
	off: "Content is no longer sent from this machine. Restart Claude Code and Codex to apply",
	// managed settingsは本人が上書きできないため、端末の設定だけでは決まらないことを示す。
	managed:
		"Your organization's managed settings also set whether content is sent, and they override this machine's setting. Ask your administrator to change them",
	savedForLogin:
		"Saved. Content will be sent after you run `harnessforce login`",
	restart: "Restart Claude Code and Codex to apply",
	loginExpired: "Your login has expired. Run `harnessforce login`",
	notRead:
		"Saved, but the workspace settings could not be read, so content is not sent yet. Run `harnessforce config set send-content on` again",
} as const;

export const settingsWriteFailedMessage = (value: "on" | "off") =>
	`Could not write the Claude Code user settings. Run \`harnessforce config set send-content ${value}\` again`;
export const codexWriteFailedMessage = (value: "on" | "off") =>
	`Could not write the Codex configuration. Run \`harnessforce config set send-content ${value}\` again`;

// correlation.md「harnessforce logout」が定める文言。
export const LOGOUT_MESSAGES = {
	codexUnreadable: "Cannot read the Codex configuration",
	nothing:
		"You are not logged in to Harnessforce, so there is nothing to log out",
	network:
		"Could not log out because communication with Harnessforce failed. The login of this machine is still active. Run `harnessforce logout` again",
	keychainRemoveFailed:
		"Could not remove the login from the keychain. Run `harnessforce logout` again",
	settingsRemoveFailed:
		"Could not remove the Harnessforce settings. Run `harnessforce logout` again",
	success:
		"Logged out of Harnessforce. Revoked the ingest key and login of this machine and removed the Harnessforce settings. Restart Claude Code and Codex to apply",
} as const;

// 手順3: 失効できなかったWorkspaceのkeyは、利用者がAccountの「My ingest keys」で失効できる。
export const unrevokedKeyMessage = (workspaceId: string) =>
	`Could not revoke the ingest key of this machine for workspace ${workspaceId} because the login had expired or was already revoked. If the key is still listed, revoke it in My ingest keys on your account page`;
