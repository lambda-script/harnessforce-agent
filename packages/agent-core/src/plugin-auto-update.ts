import { access } from "node:fs/promises";
import { join } from "node:path";
import { byCodeUnit } from "./config/canonical.js";
import { listFiles, readJsonObjectFile } from "./config/files.js";
import { isObject } from "./object.js";
import type { Env } from "./types.js";

// pluginを配るmarketplaceの名前（environments.md「接続先」）。
export const MARKETPLACE_NAME = "harnessforce-agent";
// Claude Codeは別名を正規の鍵と同じに読み、同じfileに両方があれば別名を無視する（claude-code.md「plugin と marketplace」）。
const MARKETPLACE_KEYS = ["extraKnownMarketplaces", "additionalMarketplaces"];
const DISABLING_VARIABLES = [
	"DISABLE_UPDATES",
	"DISABLE_AUTOUPDATER",
	"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
];

const noGuard = () => {};

// fileが実際に使うmarketplaceの登録の鍵の値。正規の鍵があれば別名を読まない。
export function marketplacesOf(
	settings: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	const key = MARKETPLACE_KEYS.find((name) => settings?.[name] !== undefined);
	const value = key === undefined ? undefined : settings?.[key];
	return isObject(value) ? value : undefined;
}

const declaresEntry = (settings: Record<string, unknown> | undefined) =>
	MARKETPLACE_KEYS.some((key) => {
		const value = settings?.[key];
		return isObject(value) && value[MARKETPLACE_NAME] !== undefined;
	});

async function managedFiles(managedDir: string): Promise<string[]> {
	const dropInDir = join(managedDir, "managed-settings.d");
	const dropIns = (await listFiles(dropInDir, ".json", false, noGuard)).sort(
		byCodeUnit,
	);
	return [
		join(managedDir, "managed-settings.json"),
		...dropIns.map((name) => join(dropInDir, name)),
	];
}

/**
 * Claude Codeがpluginを自動更新するとみなせるか（client-updates.md「表示」）。確かめられない場合は偽とし、outdatedを表示する。
 * user settingsのentryが真で、優先度の高いfileが同じ名前のentryを持たず、自動更新を止める変数が無い場合だけ真とする。
 */
export async function isPluginAutoUpdateEffective(options: {
	userSettingsPath: string;
	managedDir: string;
	projectDir: string;
	env: Env;
}): Promise<boolean> {
	const { env } = options;
	if (
		DISABLING_VARIABLES.some((name) => env[name] === "1") &&
		env.FORCE_AUTOUPDATE_PLUGINS !== "1"
	)
		return false;
	const higher = [
		...(await managedFiles(options.managedDir)),
		join(options.projectDir, ".claude", "settings.json"),
		join(options.projectDir, ".claude", "settings.local.json"),
	];
	for (const file of higher) {
		const exists = await access(file).then(
			() => true,
			() => false,
		);
		if (!exists) continue;
		// 読めないfileは同じ名前のentryを持つかを確かめられないため、自動更新するとみなさない。
		const settings = await readJsonObjectFile(file, noGuard);
		if (!settings || declaresEntry(settings)) return false;
	}
	const user = await readJsonObjectFile(options.userSettingsPath, noGuard);
	const entry = marketplacesOf(user)?.[MARKETPLACE_NAME];
	return isObject(entry) && entry.autoUpdate === true;
}
