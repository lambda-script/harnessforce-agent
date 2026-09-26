import { join } from "node:path";
import { byCodeUnit, sortComponents } from "./canonical.js";
import type { ConfigComponent } from "./component.js";
import {
	CollectionExpired,
	type Guard,
	isObject,
	listFiles,
	readJsonObject,
} from "./files.js";
import { collectPlugins } from "./plugins.js";
import {
	absoluteEnv,
	collectHooks,
	collectLayout,
	collectMcpServers,
	collectRules,
	type Scope,
	type ScopeFactory,
	type Settings,
	Sink,
	TooManyComponents,
} from "./scope.js";

export type CollectOptions = {
	projectRoot: string;
	homeDir: string;
	managedDir: string;
	env: Readonly<Record<string, string | undefined>>;
	// 上限時間（COLLECT_BUDGET_MS）を過ぎたらtrue。
	isExpired: () => boolean;
};
// correlation.md「構成の収集」: 収集の開始からの上限時間。hookとhf runで同じ値を使う。
export const COLLECT_BUDGET_MS = 1000;

export type CollectResult =
	| { kind: "collected"; components: ConfigComponent[] }
	| {
			kind: "skipped";
			reason: "timeout" | "too many components" | "duplicate identifier";
	  };

// hashを決めるためだけの併合。Claude Codeが値を併合する規則は再現しない（correlation.md「構成の収集」）。
async function readManagedSettings(
	managedDir: string,
	guard: Guard,
): Promise<Settings> {
	let merged = await readJsonObject(
		join(managedDir, "managed-settings.json"),
		guard,
	);
	const dropInDir = join(managedDir, "managed-settings.d");
	const dropIns = (await listFiles(dropInDir, ".json", false, guard)).sort(
		byCodeUnit,
	);
	for (const name of dropIns) {
		const dropIn = await readJsonObject(join(dropInDir, name), guard);
		if (dropIn) merged = { ...merged, ...dropIn };
	}
	return merged;
}

function collectSettings(s: Scope, settings: Settings): void {
	if (!settings) return;
	const { hooks, permissions, model } = settings;
	collectHooks(s, hooks);
	if (isObject(permissions))
		s.addValue("permissions", "permissions", permissions);
	if (typeof model === "string") s.addValue("model", model, model);
}

const objectAt = (value: Settings, key: string) => {
	const found = value?.[key];
	return isObject(found) ? found : {};
};

async function collectAll(
	options: CollectOptions,
	scope: ScopeFactory,
	guard: Guard,
): Promise<void> {
	const { projectRoot, managedDir, homeDir } = options;
	const user = join(homeDir, ".claude");
	const configDir = absoluteEnv(options.env.CLAUDE_CONFIG_DIR);
	const config = configDir ?? user;
	const project = join(projectRoot, ".claude");
	const managed = scope("managed");
	const userScope = scope("user");
	const repository = scope("repository");
	const local = scope("local");

	await collectRules(managed, managedDir, ["CLAUDE.md"]);
	await collectLayout(managed, { skills: join(managedDir, ".claude/skills") });
	// CLAUDE_CONFIG_DIRが移すと文書化されているのはsettings、plugin、workflowだけ。それ以外のuserのfileは場所が分からないため集めない。
	if (!configDir) {
		await collectRules(userScope, user, ["CLAUDE.md"], join(user, "rules"));
		await collectLayout(userScope, {
			skills: join(user, "skills"),
			agents: join(user, "agents"),
			commands: join(user, "commands"),
		});
	}
	await collectLayout(userScope, { workflows: join(config, "workflows") });
	await collectRules(
		repository,
		projectRoot,
		["CLAUDE.md", ".claude/CLAUDE.md"],
		join(project, "rules"),
	);
	await collectLayout(repository, {
		skills: join(project, "skills"),
		agents: join(project, "agents"),
		commands: join(project, "commands"),
		workflows: join(project, "workflows"),
	});
	await collectRules(local, projectRoot, ["CLAUDE.local.md"]);

	const settings = {
		managed: await readManagedSettings(managedDir, guard),
		user: await readJsonObject(join(config, "settings.json"), guard),
		repository: await readJsonObject(join(project, "settings.json"), guard),
		local: await readJsonObject(join(project, "settings.local.json"), guard),
	};
	collectSettings(managed, settings.managed);
	collectSettings(userScope, settings.user);
	collectSettings(repository, settings.repository);
	collectSettings(local, settings.local);

	const managedMcp = await readJsonObject(
		join(managedDir, "managed-mcp.json"),
		guard,
	);
	// 同じ名前はmanaged-mcp.jsonの値を採る。
	collectMcpServers(managed, {
		...objectAt(settings.managed, "managedMcpServers"),
		...objectAt(managedMcp, "mcpServers"),
	});
	const projectMcp = await readJsonObject(
		join(projectRoot, ".mcp.json"),
		guard,
	);
	collectMcpServers(repository, projectMcp?.mcpServers);
	// CLAUDE_CONFIG_DIRがある場合の.claude.jsonの場所は文書化されていないため読まない。
	if (!configDir) {
		const global = await readJsonObject(join(homeDir, ".claude.json"), guard);
		collectMcpServers(userScope, global?.mcpServers);
		collectMcpServers(
			local,
			objectAt(objectAt(global, "projects"), projectRoot).mcpServers,
		);
	}

	await collectPlugins(
		absoluteEnv(options.env.CLAUDE_CODE_PLUGIN_CACHE_DIR) ??
			join(config, "plugins"),
		// enabledPluginsを重ねる順（後ほど優先度が高い）。
		[settings.user, settings.repository, settings.local, settings.managed],
		scope,
		guard,
	);
}

export async function collectConfig(
	options: CollectOptions,
): Promise<CollectResult> {
	const guard: Guard = () => {
		if (options.isExpired()) throw new CollectionExpired();
	};
	const sink = new Sink(guard);
	try {
		await collectAll(options, sink.scope, guard);
		// 最後の読み込みの途中で上限を超えた場合も送らない。
		guard();
	} catch (error) {
		if (error instanceof CollectionExpired)
			return { kind: "skipped", reason: "timeout" };
		if (error instanceof TooManyComponents)
			return { kind: "skipped", reason: "too many components" };
		throw error;
	}
	if (sink.hasDuplicates())
		return { kind: "skipped", reason: "duplicate identifier" };
	return { kind: "collected", components: sortComponents(sink.components) };
}
