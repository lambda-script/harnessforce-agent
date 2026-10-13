import { describe, expect, it } from "vitest";
import { checkPublishBuild } from "../scripts/check-publish-build.mjs";

const mcp = (base: string) => `\${HARNESSFORCE_URL:-${base}}/mcp`;
const production = {
	cliBuildConfig: { url: "https://harnessforce.dev", isDefault: true },
	pluginMcpUrl: mcp("https://harnessforce.dev"),
};

// environments.md「接続先」: npmへpublishするのは、接続先の値を与えないbuild（既定値がproduction）だけである。
describe("checkPublishBuild", () => {
	it("accepts the build without a connection URL", () =>
		expect(() => checkPublishBuild(production)).not.toThrow());

	it("rejects a CLI built with another connection URL", () =>
		expect(() =>
			checkPublishBuild({
				...production,
				cliBuildConfig: {
					url: "https://stg.harnessforce.dev",
					isDefault: false,
				},
			}),
		).toThrow("https://stg.harnessforce.dev"));

	it("rejects a build config that does not say it is the default", () =>
		expect(() =>
			checkPublishBuild({
				...production,
				cliBuildConfig: { url: "https://harnessforce.dev" },
			}),
		).toThrow("isDefault"));

	it("rejects a plugin whose MCP server defaults to another URL", () =>
		expect(() =>
			checkPublishBuild({
				...production,
				pluginMcpUrl: mcp("http://127.0.0.1:3000"),
			}),
		).toThrow("http://127.0.0.1:3000"));
});
