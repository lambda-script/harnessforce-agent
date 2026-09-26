import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isObject } from "../config/files.js";
import { absoluteEnv } from "../config/scope.js";
import type { Env } from "../otel-headers.js";

type Settings = Record<string, unknown>;
export type UserSettingsRead =
	| { kind: "ok"; settings: Settings }
	| { kind: "invalid" };

// correlation.md「CLI」の手順6。keychainからheaderを作るhelperで、keyを設定ファイルに書かない。
const OTEL_HEADERS_HELPER = "hf otel-headers";
const PLUGIN_ID = "harnessforce@harnessforce-agent";

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
	try {
		await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`);
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}
