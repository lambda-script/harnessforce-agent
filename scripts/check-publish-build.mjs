import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
// packages/cli/scripts/build-config.mjsの既定値と同じ。releaseの確認はbuildの実装を信用せず、出力を独立に照合する。
const PRODUCTION_URL = "https://harnessforce.dev";
const PRODUCTION_MCP_URL = `\${HARNESSFORCE_URL:-${PRODUCTION_URL}}/mcp`;

/**
 * environments.md「接続先」: npmへpublishするのは、接続先の値を与えないbuild（既定値がproduction）だけである。
 * buildの後、publishの前に、配る出力が既定値のbuildであることを確かめる。
 */
export function checkPublishBuild({ cliBuildConfig, pluginMcpUrl }) {
	const problems = [];
	if (
		cliBuildConfig.isDefault !== true ||
		cliBuildConfig.url !== PRODUCTION_URL
	)
		problems.push(
			`packages/cli was built for ${cliBuildConfig.url} (isDefault: ${cliBuildConfig.isDefault}), not the production default ${PRODUCTION_URL}`,
		);
	if (pluginMcpUrl !== PRODUCTION_MCP_URL)
		problems.push(
			`the plugin MCP server URL is ${pluginMcpUrl}, not ${PRODUCTION_MCP_URL}`,
		);
	if (problems.length > 0)
		throw new Error(
			`refusing to publish a build with a non-default connection URL (environments.md 接続先):\n${problems.join("\n")}`,
		);
}

const readJson = (path) =>
	JSON.parse(readFileSync(new URL(path, root), "utf8"));

if (process.argv[1] === fileURLToPath(import.meta.url))
	checkPublishBuild({
		cliBuildConfig: readJson("packages/cli/dist/build-config.json"),
		pluginMcpUrl: readJson("plugins/harnessforce/dist/npm/.mcp.json").mcpServers
			.harnessforce.url,
	});
