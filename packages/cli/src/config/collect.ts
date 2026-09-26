import { isAbsolute, join } from "node:path";
import { hashFileContent, sortComponents } from "./canonical.js";
import type {
	ComponentKind,
	ComponentSource,
	ConfigComponent,
} from "./component.js";
import {
	CollectionExpired,
	type Guard,
	listDirectories,
	listFiles,
	readFileIfExists,
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
