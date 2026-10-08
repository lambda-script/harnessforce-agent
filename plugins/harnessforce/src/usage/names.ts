import type { Identifier } from "./store.js";

// correlation.md「名前から構成の識別子への対応」。状態のfileの識別子だけを使い、
// 候補の識別子の異なる値がちょうど1つでなければ、名前を特定できない（undefined）。

// pluginのcomponentの識別子`<name>@<marketplace>:<識別子>`（correlation.md「構成の収集」）。
// pluginの名前とmarketplaceは`:`と`@`を含まないため、最初の`:`までがpluginを表す。
const PLUGIN_COMPONENT = /^([A-Za-z0-9._-]+)@[A-Za-z0-9._-]+:(.+)$/;

function pluginPartsOf(identifier: Identifier) {
	const parts = identifier.plugin ? PLUGIN_COMPONENT.exec(identifier.id) : null;
	return parts
		? { plugin: parts[1] as string, name: parts[2] as string }
		: undefined;
}

function onlyOne(candidates: readonly Identifier[]): string | undefined {
	const ids = new Set(candidates.map((c) => c.id));
	return ids.size === 1 ? [...ids][0] : undefined;
}

// skill、command、subagentの名前。pluginのcommandとskillの名前がpluginの名前を前置するかは記載が無いため、両方の形を受け付ける。
export function identifierOfName(
	name: string,
	candidates: readonly Identifier[],
): string | undefined {
	const colon = name.indexOf(":");
	if (colon >= 0) {
		const plugin = name.slice(0, colon);
		const rest = name.slice(colon + 1);
		return onlyOne(
			candidates.filter((c) => {
				const parts = pluginPartsOf(c);
				return parts?.plugin === plugin && parts.name === rest;
			}),
		);
	}
	const direct = candidates.filter((c) => !c.plugin && c.id === name);
	return onlyOne(
		direct.length > 0
			? direct
			: candidates.filter((c) => pluginPartsOf(c)?.name === name),
	);
}

// claude-code.md「MCP の tool 名」: 英数字、`_`、`-`以外の文字は`_`に置き換えられる。
const toToolName = (name: string) => name.replace(/[^A-Za-z0-9_-]/g, "_");

// improvement-loop.md「MCP server」と同じ規則。pluginのserverは`plugin_<name>_<server>`の名前で呼ばれる。
function toolPrefixOf(server: Identifier): string | undefined {
	if (!server.plugin) return `mcp__${toToolName(server.id)}__`;
	const parts = pluginPartsOf(server);
	return (
		parts &&
		`mcp__plugin_${toToolName(parts.plugin)}_${toToolName(parts.name)}__`
	);
}

export const mcpServerOfTool = (
	toolName: string,
	servers: readonly Identifier[],
): string | undefined =>
	onlyOne(
		servers.filter((server) => {
			const prefix = toolPrefixOf(server);
			return prefix !== undefined && toolName.startsWith(prefix);
		}),
	);
