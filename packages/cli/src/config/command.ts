import type { Fetch } from "@harnessforce/agent-core/types";
import {
	type AccessDeps,
	type AccessMessages,
	verifyCliAccess,
} from "../credentials/access.js";
import { createApiTokenSession } from "../credentials/api-token-session.js";
import { ingestKeyAccount } from "../credentials/keychain.js";
import { resolveCliDestinations } from "../destinations.js";
import { fetchWorkspaceContent } from "../import/read-api.js";
import {
	type ContentLogging,
	codexConfigPath,
	readExistingCodexConfig,
	withContentLogging,
	writeCodexConfig,
} from "../shared/codex-config.js";
import {
	CONTENT_ENV_NAMES,
	type ContentSettings,
	contentEnv,
	hasManagedContentEnv,
} from "../shared/login-settings.js";
import {
	CONFIG_MESSAGES,
	codexWriteFailedMessage,
	contentEnabledMessage,
	DESTINATION_MISMATCH_MESSAGE,
	LOGIN_MESSAGES,
	NOT_LOGGED_IN_MESSAGE,
	settingsWriteFailedMessage,
} from "../shared/messages.js";
import {
	readUserSettings,
	userSettingsPath,
	withEnvValues,
	writeUserSettings,
} from "../shared/settings.js";
import { runUntilStop, stopMessage, stopWith } from "../shared/stop.js";
import { readSendContent, writeSendContent } from "./device-settings.js";

export type ConfigDeps = AccessDeps & {
	managedDir: string;
	stdout: (text: string) => void;
	stderr: (text: string) => void;
	fetch: Fetch;
	now: () => number;
	sleep: (ms: number) => Promise<void>;
};

type SendContent = "on" | "off";
export type ConfigArgs = { kind: "get" } | { kind: "set"; value: SendContent };

// correlation.md「端末の本文の送信の設定」: 扱う鍵は`send-content`だけ。違う引数はundefined。
export function parseConfigArgs(
	args: readonly string[],
): ConfigArgs | undefined {
	const [action, key, value, ...extra] = args;
	if (key !== "send-content" || extra.length > 0) return undefined;
	if (action === "get" && value === undefined) return { kind: "get" };
	if (action === "set" && (value === "on" || value === "off"))
		return { kind: "set", value };
	return undefined;
}

// `harnessforce config get send-content`。読めない設定は、送らない指示を読み損ねて送らないよう値を出さない。
export async function configGet(
	deps: Pick<ConfigDeps, "homeDir" | "stdout" | "stderr">,
): Promise<number> {
	const sendContent = await readSendContent(deps.homeDir);
	if (sendContent === "unreadable") {
		deps.stderr(`${LOGIN_MESSAGES.deviceSettingsUnreadable}\n`);
		return 1;
	}
	deps.stdout(`${sendContent ? "on" : "off"}\n`);
	return 0;
}

// `harnessforce config set send-content on|off`。端末の設定を先に書き、後の失敗でも利用者の選択を残す。
export function configSet(
	value: SendContent,
	deps: ConfigDeps,
): Promise<number> {
	return runUntilStop(async () => {
		const saved = await writeSendContent(deps.homeDir, value === "on");
		if (saved === "unreadable") stopWith(CONFIG_MESSAGES.notChanged);
		if (saved === "writeFailed") stopWith(CONFIG_MESSAGES.saveFailed);
		return value === "off" ? turnOff(deps) : turnOn(deps);
	}, deps.stderr);
}

// ログインの状態とkeychainを確かめず、通信もしない。keychainが使えない端末やログインの切れた端末でも、
// 利用者が選んだ停止をその場で設定へ反映するためである。
async function turnOff(deps: ConfigDeps): Promise<number> {
	await writeContentSettings(
		Object.fromEntries(CONTENT_ENV_NAMES.map((name) => [name, "0"])),
		{ logUserPrompt: false, logAgentResponses: false },
		{ onlyPresent: true, value: "off" },
		deps,
	);
	await printApplied([CONFIG_MESSAGES.off], deps);
	return 0;
}

async function turnOn(deps: ConfigDeps): Promise<number> {
	if (!(await isLoggedIn(deps))) {
		await printApplied([CONFIG_MESSAGES.savedForLogin], deps);
		return 0;
	}
	const content = await readWorkspaceContent(deps).catch((error: unknown) => {
		const text = stopMessage(error);
		if (text === undefined) throw error;
		deps.stderr(`${text}\n`);
		return undefined;
	});
	// 保存した`on`は残り、次の`harnessforce login`でも使われる。
	if (!content) return stopWith(CONFIG_MESSAGES.notRead);
	await writeContentSettings(
		contentEnv(content, true),
		{
			logUserPrompt: content.isPromptsStored,
			logAgentResponses: content.isModelAndToolsStored,
		},
		{ onlyPresent: false, value: "on" },
		deps,
	);
	await printApplied([contentNotice(content), CONFIG_MESSAGES.restart], deps);
	return 0;
}

// `harnessforce import`と同じ規則でWorkspaceが決まり、その`<workspace_id>:ingest-key`がkeychainにある。
// keychainが使えない、または読めない場合はログイン済みでないものとする。
async function isLoggedIn(deps: ConfigDeps): Promise<boolean> {
	const { workspaceId } = await resolveCliDestinations(
		deps.env,
		userSettingsPath(deps.env, deps.homeDir),
		deps.defaultUrl,
	);
	if (!workspaceId) return false;
	if (!(await deps.keychain.isAvailable().catch(() => false))) return false;
	const key = await deps.keychain
		.get(ingestKeyAccount(workspaceId))
		.catch(() => undefined);
	return Boolean(key);
}

const ACCESS_MESSAGES: AccessMessages = {
	keychainUnavailable: LOGIN_MESSAGES.keychainUnavailable,
	loginRequired: NOT_LOGGED_IN_MESSAGE,
	destinationMismatch: DESTINATION_MISMATCH_MESSAGE,
	invalidUrl: LOGIN_MESSAGES.invalidUrl,
	apiTokenMissing: NOT_LOGGED_IN_MESSAGE,
};

// 読むWorkspace、宛先、送信先の固定、ApiTokenのrefreshは`harnessforce import`と同じとする。
// 終端の文言がある失敗は終端で抜け、通信の失敗と条件を満たさない`content`はundefinedを返す。
async function readWorkspaceContent(
	deps: ConfigDeps,
): Promise<ContentSettings | undefined> {
	const access = await verifyCliAccess(deps, ACCESS_MESSAGES);
	const readFetch = createApiTokenSession({
		keychain: deps.keychain,
		workspaceId: access.workspaceId,
		readBase: access.readApiBase,
		fetch: deps.fetch,
		now: deps.now,
		sleep: deps.sleep,
		homeDir: deps.homeDir,
	}).authorizedFetch(deps.fetch);
	const outcome = await fetchWorkspaceContent(
		access.readApiBase,
		access.accessToken,
		readFetch,
	);
	// 401はrefreshしても使えるaccess tokenを得られなかった場合だけ届く。
	if (outcome.kind === "unauthorized") stopWith(CONFIG_MESSAGES.loginExpired);
	return outcome.kind === "ok" ? outcome.value : undefined;
}

const contentNotice = (content: ContentSettings) =>
	content.isPromptsStored || content.isModelAndToolsStored
		? contentEnabledMessage(content)
		: LOGIN_MESSAGES.contentNotStored;

// user settingsの`env`とCodexの`config.toml`の本文の値を書く。Codexの`config.toml`が無ければ書かない。
// onlyPresentのときは、ある変数と値だけを書き換え、無いものを加えない。
async function writeContentSettings(
	env: Readonly<Record<string, string>>,
	logging: ContentLogging,
	options: { onlyPresent: boolean; value: SendContent },
	deps: ConfigDeps,
): Promise<void> {
	const settingsFailed = () =>
		stopWith(settingsWriteFailedMessage(options.value));
	const settingsPath = userSettingsPath(deps.env, deps.homeDir);
	const current = await readUserSettings(settingsPath);
	if (current.kind === "invalid") settingsFailed();
	const settings = current.kind === "ok" ? current.settings : {};
	const present = (settings.env as Record<string, unknown> | undefined) ?? {};
	const values = options.onlyPresent
		? Object.fromEntries(
				Object.entries(env).filter(([name]) => Object.hasOwn(present, name)),
			)
		: env;
	if (Object.keys(values).length > 0)
		await writeUserSettings(
			settingsPath,
			withEnvValues(settings, values),
		).catch(settingsFailed);

	const codexFailed = () => stopWith(codexWriteFailedMessage(options.value));
	const codexPath = codexConfigPath(deps.env, deps.homeDir);
	const text = await readExistingCodexConfig(codexPath).catch(codexFailed);
	if (text === undefined) return;
	let next: string;
	try {
		next = withContentLogging(text, logging, options.onlyPresent);
	} catch {
		return codexFailed();
	}
	if (next !== text) await writeCodexConfig(codexPath, next).catch(codexFailed);
}

// managed settingsのfileの`env`が本文の変数を持てば、本人は上書きできないことを続けて示す。
async function printApplied(lines: string[], deps: ConfigDeps): Promise<void> {
	const isManaged = await hasManagedContentEnv(deps.managedDir);
	deps.stdout(
		`${[...lines, ...(isManaged ? [CONFIG_MESSAGES.managed] : [])].join("\n")}\n`,
	);
}
