import { join } from "node:path";
import { absoluteEnv } from "@harnessforce/agent-core/config/scope";
import { readManagedEnv } from "@harnessforce/agent-core/managed";
import { isObject } from "@harnessforce/agent-core/object";
import { readUserSettings } from "../shared/settings.js";

// user settingsの`env`の文字列の値。読めないfileは値が無いものとする。
async function readSettingsEnv(
	path: string,
): Promise<Record<string, string | undefined>> {
	const read = await readUserSettings(path);
	const env = read.kind === "ok" ? read.settings.env : undefined;
	if (!isObject(env)) return {};
	return Object.fromEntries(
		Object.entries(env).filter(([, value]) => typeof value === "string"),
	) as Record<string, string>;
}

// correlation.md「session import」の記録の基点の読み方で、環境変数の名前ごとに最初にある絶対pathの値を読む。
// processの環境変数はrepositoryのsettingsが書き換えられるため読まず、managed settingsのfile、
// ~/.claude/settings.jsonのenvの順に読む。~/.claude/settings.jsonを固定するのは、環境変数が指す
// settingsのfileもrepositoryが用意できるためである。
export async function readTrustedEnv<const N extends string>(
	deps: { homeDir: string; managedDir: string },
	names: readonly N[],
): Promise<Partial<Record<N, string>>> {
	const managed = await readManagedEnv(deps.managedDir, names);
	const user = await readSettingsEnv(
		join(deps.homeDir, ".claude", "settings.json"),
	);
	const found: Partial<Record<N, string>> = {};
	for (const name of names) {
		const value = absoluteEnv(managed[name]) ?? absoluteEnv(user[name]);
		if (value !== undefined) found[name] = value;
	}
	return found;
}

export async function recordBase(deps: {
	homeDir: string;
	managedDir: string;
}): Promise<string> {
	const { CLAUDE_CONFIG_DIR: configDir } = await readTrustedEnv(deps, [
		"CLAUDE_CONFIG_DIR",
	]);
	return configDir ?? join(deps.homeDir, ".claude");
}
