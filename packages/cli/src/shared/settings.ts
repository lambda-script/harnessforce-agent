import { randomUUID } from "node:crypto";
import {
	chmod,
	mkdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { absoluteEnv } from "@harnessforce/agent-core/config/scope";
import { isObject } from "@harnessforce/agent-core/object";
import { MARKETPLACE_NAME } from "@harnessforce/agent-core/plugin-auto-update";
import type { Env } from "@harnessforce/agent-core/types";

type Settings = Record<string, unknown>;
export type UserSettingsRead =
	| { kind: "ok"; settings: Settings }
	| { kind: "invalid" };

// correlation.md「CLI」の手順6。keychainからheaderを作るhelperで、keyを設定ファイルに書かない。
const OTEL_HEADERS_HELPER = "harnessforce otel-headers";
const PLUGIN_ID = "harnessforce@harnessforce-agent";
// user settingsは他のsecret（apiKeyHelperなど）を持ちうるため、新しいfileは所有者だけが読めるようにする。
const NEW_FILE_MODE = 0o600;

// 構成の収集のsource `user`と同じfile（configの基点のsettings.json）。
export function userSettingsPath(env: Env, homeDir: string): string {
	const configDir =
		absoluteEnv(env.CLAUDE_CONFIG_DIR) ?? join(homeDir, ".claude");
	return join(configDir, "settings.json");
}

export async function readUserSettings(
	path: string,
): Promise<UserSettingsRead> {
	let content: string;
	try {
		content = await readFile(path, "utf8");
	} catch (error) {
		const isMissing = (error as NodeJS.ErrnoException).code === "ENOENT";
		return isMissing ? { kind: "ok", settings: {} } : { kind: "invalid" };
	}
	try {
		const settings: unknown = JSON.parse(content);
		const isValid =
			isObject(settings) &&
			(settings.env === undefined || isObject(settings.env)) &&
			(settings.enabledPlugins === undefined ||
				isObject(settings.enabledPlugins));
		return isValid ? { kind: "ok", settings } : { kind: "invalid" };
	} catch {
		return { kind: "invalid" };
	}
}

// client-updates.md「Claude Codeのplugin」: 自動更新を書くmarketplaceの登録の鍵。別名だけがあるfileでは別名に書く。
const MARKETPLACE_KEYS = ["extraKnownMarketplaces", "additionalMarketplaces"];
const MARKETPLACE_SOURCE = {
	source: "github",
	repo: "lambda-script/harnessforce-agent",
} as const;

const isMarketplacesValid = (value: unknown) =>
	value === undefined ||
	(isObject(value) &&
		(value[MARKETPLACE_NAME] === undefined ||
			isObject(value[MARKETPLACE_NAME])));

// correlation.md「CLI」の手順1と6: initが自動更新を書けるか。読み取りだけのcommandは確かめない。
export const hasWritableMarketplaces = (settings: Settings): boolean =>
	MARKETPLACE_KEYS.every((key) => isMarketplacesValid(settings[key]));

/**
 * marketplaceの登録の鍵の`harnessforce-agent`に、sourceと自動更新を書く。sourceと、利用者が切り替えた真偽値は残し、
 * turnOffのときだけ偽にする。自動更新が有効になったかも返す。
 */
export function withPluginAutoUpdate(
	settings: Settings,
	turnOff: boolean,
): { settings: Settings; isOn: boolean } {
	const key =
		settings.additionalMarketplaces !== undefined &&
		settings.extraKnownMarketplaces === undefined
			? "additionalMarketplaces"
			: "extraKnownMarketplaces";
	const marketplaces = (settings[key] as Settings | undefined) ?? {};
	const entry = (marketplaces[MARKETPLACE_NAME] as Settings | undefined) ?? {};
	const autoUpdate = turnOff
		? false
		: typeof entry.autoUpdate === "boolean"
			? entry.autoUpdate
			: true;
	return {
		settings: {
			...settings,
			[key]: {
				...marketplaces,
				[MARKETPLACE_NAME]: {
					...entry,
					source: entry.source ?? MARKETPLACE_SOURCE,
					autoUpdate,
				},
			},
		},
		isOn: autoUpdate,
	};
}

// 最上位はenv、otelHeadersHelper、enabledPluginsだけを変え、envとenabledPluginsの他の鍵は残す。
export function mergeUserSettings(
	settings: Settings,
	env: Readonly<Record<string, string>>,
): Settings {
	return {
		...settings,
		env: { ...(settings.env as Settings | undefined), ...env },
		otelHeadersHelper: OTEL_HEADERS_HELPER,
		enabledPlugins: {
			...(settings.enabledPlugins as Settings | undefined),
			[PLUGIN_ID]: true,
		},
	};
}

// Claude Codeも同じfileを書くため、途中まで書かれたfileを読ませないよう一時fileからrenameで置き換える。
export async function writeUserSettings(
	path: string,
	settings: Settings,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${randomUUID()}.tmp`;
	// renameで置き換えても、既存のfileの権限を広げない。
	const mode = await stat(path).then(
		(existing) => existing.mode & 0o777,
		() => NEW_FILE_MODE,
	);
	try {
		await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
			mode,
			flag: "wx",
		});
		// umaskの影響を受けないよう、作った後に揃える。
		await chmod(temporary, mode);
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}
