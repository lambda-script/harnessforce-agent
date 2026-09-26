import { isAbsolute, join } from "node:path";
import {
	byCodeUnit,
	hashFileContent,
	hashValue,
	sortComponents,
} from "./canonical.js";
import type {
	ComponentKind,
	ComponentSource,
	ConfigComponent,
} from "./component.js";
import {
	CollectionExpired,
	type Guard,
	isObject,
	listDirectories,
	listFiles,
	readFileIfExists,
	readJsonObject,
} from "./files.js";

export type CollectOptions = {
	projectRoot: string;
	homeDir: string;
	managedDir: string;
	env: Readonly<Record<string, string | undefined>>;
	// 上限時間（hookのprocessの起動から1秒）を過ぎたらtrue。
	isExpired: () => boolean;
};
export type CollectResult =
	| { kind: "collected"; components: ConfigComponent[] }
	| { kind: "skipped"; reason: "timeout" | "too many components" };

// correlation.md「構成の収集」。一部だけを集めたsnapshotは構成を誤って表すため、超えたら送らない。
const MAX_COMPONENTS = 1000;
// semconvのTokenと同じ制約。
const IDENTIFIER = /^\S{1,256}$/;

class TooManyComponents extends Error {}

class Collector {
	readonly components: ConfigComponent[] = [];
	readonly guard: Guard;

	constructor(isExpired: () => boolean) {
		this.guard = () => {
			if (isExpired()) throw new CollectionExpired();
		};
	}

	add(component: ConfigComponent): void {
		if (!IDENTIFIER.test(component.id)) return;
		if (this.components.length >= MAX_COMPONENTS) throw new TooManyComponents();
		this.components.push(component);
	}

	addValue(
		kind: ComponentKind,
		source: ComponentSource,
		id: string,
		value: unknown,
	): void {
		this.add({ kind, source, id, hash: hashValue(value) });
	}

	async addFile(
		kind: ComponentKind,
		source: ComponentSource,
		id: string,
		path: string,
	): Promise<void> {
		const content = await readFileIfExists(path, this.guard);
		if (content) this.add({ kind, source, id, hash: hashFileContent(content) });
	}
}

const absoluteEnv = (value: string | undefined) =>
	value && isAbsolute(value) ? value : undefined;
const withoutExt = (path: string, ext: string) => path.slice(0, -ext.length);
const commandName = (path: string) =>
	withoutExt(path, ".md").replace(/\//g, ":");

// kindごとの配置（userとrepositoryと、後でpluginにも使う）。
type Layout = {
	skills?: string;
	agents?: string;
	commands?: string;
	workflows?: string;
};

async function collectLayout(
	c: Collector,
	source: ComponentSource,
	layout: Layout,
): Promise<void> {
	if (layout.skills)
		for (const name of await listDirectories(layout.skills, c.guard))
			await c.addFile(
				"skill",
				source,
				name,
				join(layout.skills, name, "SKILL.md"),
			);
	if (layout.agents)
		for (const path of await listFiles(layout.agents, ".md", true, c.guard))
			await c.addFile(
				"agent",
				source,
				commandName(path),
				join(layout.agents, path),
			);
	if (layout.commands)
		for (const path of await listFiles(layout.commands, ".md", true, c.guard))
			await c.addFile(
				"command",
				source,
				commandName(path),
				join(layout.commands, path),
			);
	if (layout.workflows)
		for (const path of await listFiles(layout.workflows, ".js", false, c.guard))
			await c.addFile(
				"workflow",
				source,
				withoutExt(path, ".js"),
				join(layout.workflows, path),
			);
}

async function collectRules(
	c: Collector,
	source: ComponentSource,
	base: string,
	names: readonly string[],
	rulesDir: string | undefined,
): Promise<void> {
	for (const name of names)
		await c.addFile("rule", source, name, join(base, name));
	if (rulesDir)
		for (const path of await listFiles(rulesDir, ".md", true, c.guard))
			await c.addFile("rule", source, `rules/${path}`, join(rulesDir, path));
}

type Settings = Record<string, unknown> | undefined;

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

function collectSettings(
	c: Collector,
	source: ComponentSource,
	settings: Settings,
): void {
	if (!settings) return;
	const { hooks, permissions, model } = settings;
	if (isObject(hooks))
		for (const [event, value] of Object.entries(hooks))
			c.addValue("hook", source, event, value);
	if (isObject(permissions))
		c.addValue("permissions", source, "permissions", permissions);
	if (typeof model === "string") c.addValue("model", source, model, model);
}

function collectMcpServers(
	c: Collector,
	source: ComponentSource,
	servers: unknown,
): void {
	if (!isObject(servers)) return;
	for (const [name, value] of Object.entries(servers))
		if (isObject(value)) c.addValue("mcp_server", source, name, value);
}

async function collectMcp(
	c: Collector,
	options: CollectOptions,
	managedSettings: Settings,
	hasConfigDir: boolean,
): Promise<void> {
	const managedMcp = await readJsonObject(
		join(options.managedDir, "managed-mcp.json"),
		c.guard,
	);
	// 同じ名前はmanaged-mcp.jsonの値を採る。
	collectMcpServers(c, "managed", {
		...(isObject(managedSettings?.managedMcpServers)
			? managedSettings.managedMcpServers
			: {}),
		...(isObject(managedMcp?.mcpServers) ? managedMcp.mcpServers : {}),
	});
	const projectMcp = await readJsonObject(
		join(options.projectRoot, ".mcp.json"),
		c.guard,
	);
	collectMcpServers(c, "repository", projectMcp?.mcpServers);
	// CLAUDE_CONFIG_DIRがある場合の.claude.jsonの場所は文書化されていないため読まない。
	if (hasConfigDir) return;
	const global = await readJsonObject(
		join(options.homeDir, ".claude.json"),
		c.guard,
	);
	collectMcpServers(c, "user", global?.mcpServers);
	const projects = global?.projects;
	const project = isObject(projects)
		? projects[options.projectRoot]
		: undefined;
	if (isObject(project)) collectMcpServers(c, "local", project.mcpServers);
}

async function collectAll(
	c: Collector,
	options: CollectOptions,
): Promise<void> {
	const { projectRoot, managedDir } = options;
	const user = join(options.homeDir, ".claude");
	const configDir = absoluteEnv(options.env.CLAUDE_CONFIG_DIR);
	const config = configDir ?? user;
	const project = join(projectRoot, ".claude");

	await collectRules(c, "managed", managedDir, ["CLAUDE.md"], undefined);
	await collectLayout(c, "managed", {
		skills: join(managedDir, ".claude/skills"),
	});

	// CLAUDE_CONFIG_DIRが移すと文書化されているのはsettings、plugin、workflowだけ。それ以外のuserのfileは場所が分からないため集めない。
	if (!configDir) {
		await collectRules(c, "user", user, ["CLAUDE.md"], join(user, "rules"));
		await collectLayout(c, "user", {
			skills: join(user, "skills"),
			agents: join(user, "agents"),
			commands: join(user, "commands"),
		});
	}
	await collectLayout(c, "user", { workflows: join(config, "workflows") });

	await collectRules(
		c,
		"repository",
		projectRoot,
		["CLAUDE.md", ".claude/CLAUDE.md"],
		join(project, "rules"),
	);
	await collectLayout(c, "repository", {
		skills: join(project, "skills"),
		agents: join(project, "agents"),
		commands: join(project, "commands"),
		workflows: join(project, "workflows"),
	});
	await collectRules(c, "local", projectRoot, ["CLAUDE.local.md"], undefined);

	const managedSettings = await readManagedSettings(managedDir, c.guard);
	collectSettings(c, "managed", managedSettings);
	collectSettings(
		c,
		"user",
		await readJsonObject(join(config, "settings.json"), c.guard),
	);
	collectSettings(
		c,
		"repository",
		await readJsonObject(join(project, "settings.json"), c.guard),
	);
	collectSettings(
		c,
		"local",
		await readJsonObject(join(project, "settings.local.json"), c.guard),
	);
	await collectMcp(c, options, managedSettings, configDir !== undefined);
}

export async function collectConfig(
	options: CollectOptions,
): Promise<CollectResult> {
	const c = new Collector(options.isExpired);
	try {
		await collectAll(c, options);
	} catch (error) {
		if (error instanceof CollectionExpired)
			return { kind: "skipped", reason: "timeout" };
		if (error instanceof TooManyComponents)
			return { kind: "skipped", reason: "too many components" };
		throw error;
	}
	return { kind: "collected", components: sortComponents(c.components) };
}
