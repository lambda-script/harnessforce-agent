import { join } from "node:path";
import {
	exists,
	type Guard,
	isObject,
	listDirectories,
	readJsonObject,
} from "./files.js";
import {
	collectHooks,
	collectLayout,
	collectMcpServers,
	type ScopeFactory,
	type Settings,
} from "./scope.js";

// marketplaceとして扱わないorigin（claude-code.md「plugin と marketplace」）。inlineはsession限り、
// skills-dirはcacheを使わず、syncedは配置が文書化されていない。
const NON_MARKETPLACE_ORIGINS = new Set(["inline", "skills-dir", "synced"]);
// repositoryのsettingsがplugins rootの外を指せないよう、pathの区切りを含まない名前だけを受け付ける。
const PLUGIN_ID = /^([A-Za-z0-9._-]+)@([A-Za-z0-9._-]+)$/;
const isPathSegment = (name: string) => name !== "." && name !== "..";
const VERSION = /^\S{1,64}$/;
// 更新または削除で前のversionのdirectoryに書かれる印。
const ORPHANED_MARK = ".orphaned_at";

// sourcesは優先度の低い順。pluginのidごとに、最後に現れた値を採る。
function enabledPluginIds(sources: readonly Settings[]): string[] {
	const merged = new Map<string, unknown>();
	for (const settings of sources) {
		const enabled = settings?.enabledPlugins;
		if (isObject(enabled))
			for (const [id, value] of Object.entries(enabled)) merged.set(id, value);
	}
	return [...merged].filter(([, value]) => value === true).map(([id]) => id);
}

// .orphaned_atを持たないversionのdirectoryがちょうど1つのときだけ、それを導入先とみなす。
async function liveVersion(
	pluginDir: string,
	guard: Guard,
): Promise<string | undefined> {
	const live: string[] = [];
	for (const version of await listDirectories(pluginDir, guard))
		if (!(await exists(join(pluginDir, version, ORPHANED_MARK), guard)))
			live.push(version);
	return live.length === 1 ? live[0] : undefined;
}

export async function collectPlugins(
	pluginsRoot: string,
	settingsByPrecedence: readonly Settings[],
	scope: ScopeFactory,
	guard: Guard,
): Promise<void> {
	for (const id of enabledPluginIds(settingsByPrecedence)) {
		const [, name, marketplace] = PLUGIN_ID.exec(id) ?? [];
		if (
			!name ||
			!marketplace ||
			!isPathSegment(name) ||
			!isPathSegment(marketplace) ||
			NON_MARKETPLACE_ORIGINS.has(marketplace)
		)
			continue;
		const pluginDir = join(pluginsRoot, "cache", marketplace, name);
		const version = await liveVersion(pluginDir, guard);
		if (version === undefined) continue;
		const root = join(pluginDir, version);
		const s = scope(
			"plugin",
			`${id}:`,
			VERSION.test(version) ? version : undefined,
		);
		await collectLayout(s, {
			skills: join(root, "skills"),
			agents: join(root, "agents"),
			commands: join(root, "commands"),
			workflows: join(root, "workflows"),
		});
		collectHooks(
			s,
			(await readJsonObject(join(root, "hooks/hooks.json"), guard))?.hooks,
		);
		collectMcpServers(
			s,
			(await readJsonObject(join(root, ".mcp.json"), guard))?.mcpServers,
		);
	}
}
