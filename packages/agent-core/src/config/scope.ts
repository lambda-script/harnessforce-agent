import { isAbsolute, join } from "node:path";
import { isObject } from "../object.js";
import { hashFileContent, hashValue } from "./canonical.js";
import type {
	ComponentKind,
	ComponentSource,
	ConfigComponent,
} from "./component.js";
import {
	type Guard,
	listDirectories,
	listFiles,
	readFileIfExists,
} from "./files.js";

// correlation.md「構成の収集」。一部だけを集めたsnapshotは構成を誤って表すため、超えたら送らない。
const MAX_COMPONENTS = 1000;
// semconvのTokenと同じ制約。
const IDENTIFIER = /^\S{1,256}$/;

export class TooManyComponents extends Error {}

export type Settings = Record<string, unknown> | undefined;

// 1つの収集元（sourceと、pluginでは識別子の接頭辞とversion）へcomponentを加える。
export type Scope = {
	guard: Guard;
	addValue(kind: ComponentKind, id: string, value: unknown): void;
	addFile(kind: ComponentKind, id: string, path: string): Promise<void>;
};
export type ScopeFactory = (
	source: ComponentSource,
	idPrefix?: string,
	version?: string,
) => Scope;

export class Sink {
	readonly components: ConfigComponent[] = [];

	constructor(private readonly guard: Guard) {}

	private add(component: ConfigComponent): void {
		if (!IDENTIFIER.test(component.id)) return;
		if (this.components.length >= MAX_COMPONENTS) throw new TooManyComponents();
		this.components.push(component);
	}

	// 異なるfileが同じkind、source、識別子になったか（correlation.md「構成の収集」）。
	hasDuplicates(): boolean {
		const keys = new Set(
			this.components.map((c) => `${c.kind}\0${c.source}\0${c.id}`),
		);
		return keys.size !== this.components.length;
	}

	readonly scope: ScopeFactory = (source, idPrefix = "", version) => {
		const add = (kind: ComponentKind, id: string, hash: string) =>
			this.add({
				kind,
				source,
				id: `${idPrefix}${id}`,
				...(version === undefined ? {} : { version }),
				hash,
			});
		return {
			guard: this.guard,
			addValue: (kind, id, value) => add(kind, id, hashValue(value)),
			addFile: async (kind, id, path) => {
				const content = await readFileIfExists(path, this.guard);
				if (content) add(kind, id, hashFileContent(content));
			},
		};
	};
}

export const absoluteEnv = (value: string | undefined) =>
	value && isAbsolute(value) ? value : undefined;
const withoutExt = (path: string, ext: string) => path.slice(0, -ext.length);
const colonName = (path: string) => withoutExt(path, ".md").replace(/\//g, ":");

// kindごとの配置。user、repository、pluginで同じ規則を使う。
export type Layout = {
	skills?: string;
	agents?: string;
	commands?: string;
	workflows?: string;
};

export async function collectLayout(s: Scope, layout: Layout): Promise<void> {
	if (layout.skills)
		for (const name of await listDirectories(layout.skills, s.guard))
			await s.addFile("skill", name, join(layout.skills, name, "SKILL.md"));
	if (layout.agents)
		for (const path of await listFiles(layout.agents, ".md", true, s.guard))
			await s.addFile("agent", colonName(path), join(layout.agents, path));
	if (layout.commands)
		for (const path of await listFiles(layout.commands, ".md", true, s.guard))
			await s.addFile("command", colonName(path), join(layout.commands, path));
	if (layout.workflows)
		for (const path of await listFiles(layout.workflows, ".js", false, s.guard))
			await s.addFile(
				"workflow",
				withoutExt(path, ".js"),
				join(layout.workflows, path),
			);
}

export async function collectRules(
	s: Scope,
	base: string,
	names: readonly string[],
	rulesDir?: string,
): Promise<void> {
	for (const name of names) await s.addFile("rule", name, join(base, name));
	if (rulesDir)
		for (const path of await listFiles(rulesDir, ".md", true, s.guard))
			await s.addFile("rule", `rules/${path}`, join(rulesDir, path));
}

export function collectHooks(s: Scope, hooks: unknown): void {
	if (!isObject(hooks)) return;
	for (const [event, value] of Object.entries(hooks))
		s.addValue("hook", event, value);
}

export function collectMcpServers(s: Scope, servers: unknown): void {
	if (!isObject(servers)) return;
	for (const [name, value] of Object.entries(servers))
		if (isObject(value)) s.addValue("mcp_server", name, value);
}
