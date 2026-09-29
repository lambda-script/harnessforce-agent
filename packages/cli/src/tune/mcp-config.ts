// improvement-loop.md「MCP server」: sessionのconfig snapshotの`mcp_server`の識別子と、記録のtool名の対応。

// `unlisted`は識別子に対応しない呼び出しをまとめる名前であり、同じ名前のserverは対応させない。
export const UNLISTED = "unlisted";

export type McpConfig = {
	// 識別子（重複なし、UTF-16のcode unitの順）。
	servers: readonly string[];
	// tool名の呼び出しの識別子。どの識別子にもちょうど1つに対応しなければ`unlisted`。
	serverOf: (toolName: string) => string;
};

// pluginのserverの識別子（correlation.md「構成の収集」の`<name>@<marketplace>:<server>`）。
const PLUGIN_SERVER = /^([A-Za-z0-9._-]+)@[A-Za-z0-9._-]+:(.+)$/;
// claude-code.md「MCP の tool 名」: 英数字、`_`、`-`以外の文字は`_`に置き換えられる。
const toToolName = (name: string) => name.replace(/[^A-Za-z0-9_-]/g, "_");

function toolPrefixOf(identifier: string): string {
	const plugin = PLUGIN_SERVER.exec(identifier);
	const name = plugin
		? `plugin_${toToolName(plugin[1] as string)}_${toToolName(plugin[2] as string)}`
		: toToolName(identifier);
	return `mcp__${name}__`;
}

export const isMcpTool = (toolName: string) => toolName.startsWith("mcp__");

export function mcpConfigOf(identifiers: readonly string[]): McpConfig {
	const servers = [...new Set(identifiers)]
		.filter((id) => id !== UNLISTED)
		.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
	const prefixes = servers.map((id) => [id, toolPrefixOf(id)] as const);
	return {
		servers,
		serverOf: (toolName) => {
			const matches = prefixes.filter(([, prefix]) =>
				toolName.startsWith(prefix),
			);
			return matches.length === 1 ? (matches[0]?.[0] as string) : UNLISTED;
		},
	};
}
