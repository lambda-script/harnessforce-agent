// improvement-loop.md「MCP server」: sessionのconfig snapshotの`mcp_server`の識別子と、記録のtool名の対応。

export type McpConfig = {
	// 識別子（重複なし、UTF-16のcode unitの順）。
	servers: readonly string[];
	// tool名の`mcp__<server名>__`の部分から、ちょうど1つに対応する識別子。
	byToolSegment: ReadonlyMap<string, string>;
};

// pluginのserverの識別子（correlation.md「構成の収集」の`<name>@<marketplace>:<server>`）。
const PLUGIN_SERVER = /^([A-Za-z0-9._-]+)@[A-Za-z0-9._-]+:(.+)$/;
// claude-code.md「MCP の tool 名」: 英数字、`_`、`-`以外の文字は`_`に置き換えられる。
const toToolName = (name: string) => name.replace(/[^A-Za-z0-9_-]/g, "_");

function segmentOf(identifier: string): string {
	const plugin = PLUGIN_SERVER.exec(identifier);
	return plugin
		? `plugin_${toToolName(plugin[1] as string)}_${toToolName(plugin[2] as string)}`
		: toToolName(identifier);
}

// `unlisted`は識別子の無い呼び出しをまとめる名前であり、同じ名前のserverは対応させない。
export const UNLISTED = "unlisted";

export function mcpConfigOf(identifiers: readonly string[]): McpConfig {
	const servers = [...new Set(identifiers)]
		.filter((id) => id !== UNLISTED)
		.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	const candidates = new Map<string, string[]>();
	for (const id of servers) {
		const segment = segmentOf(id);
		candidates.set(segment, [...(candidates.get(segment) ?? []), id]);
	}
	const byToolSegment = new Map<string, string>();
	for (const [segment, ids] of candidates)
		if (ids.length === 1) byToolSegment.set(segment, ids[0] as string);
	return { servers, byToolSegment };
}

// `mcp__<server名>__<tool名>`の<server名>。MCPのtoolでなければundefined。
export function toolSegment(toolName: string): string | undefined {
	if (!toolName.startsWith("mcp__")) return undefined;
	const end = toolName.indexOf("__", 5);
	return end > 5 ? toolName.slice(5, end) : undefined;
}
