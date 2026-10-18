import { describe, expect, it } from "vitest";
import { hashInput } from "../../src/config/hash-input.js";

describe("hashInput", () => {
	it("keeps only the key names of env and headers and drops args from an MCP server", () =>
		expect(
			hashInput("mcp_server", {
				command: "npx",
				args: ["-y", "server", "--api-key", "secret"],
				env: { TOKEN: "secret", API: "secret" },
				timeout: 5,
			}),
		).toEqual({ command: "npx", env: ["API", "TOKEN"], timeout: 5 }));

	it("strips userinfo, query and fragment from the URL and keeps scheme, host, port and path", () =>
		expect(
			hashInput("mcp_server", {
				type: "http",
				url: "https://user:secret@mcp.example.test:8443/v1/mcp?token=secret#x",
				headers: { Authorization: "Bearer secret" },
			}),
		).toEqual({
			type: "http",
			url: "https://mcp.example.test:8443/v1/mcp",
			headers: ["Authorization"],
		}));

	it.each([
		// biome-ignore lint/suspicious/noTemplateCurlyInString: .mcp.jsonの環境変数の展開であり、JSのtemplateではない。
		["a URL written as one variable", { url: "${MCP_URL}" }],
		["a URL that is not a string", { url: 1 }],
		["env that is not an object", { env: ["A=secret"] }],
		["headers that are not an object", { headers: "Authorization: secret" }],
	])("drops %s", (_, value) =>
		expect(hashInput("mcp_server", { command: "x", ...value })).toEqual({
			command: "x",
		}),
	);

	it("reduces each hook handler of each matcher group and keeps the command", () =>
		expect(
			hashInput("hook", [
				{
					matcher: "Bash",
					hooks: [
						{ type: "command", command: "node", args: ["hook.js", "secret"] },
						{
							type: "http",
							url: "https://hooks.example.test/h?key=secret",
							headers: { "X-Key": "secret" },
						},
						"not a handler",
					],
				},
				{ hooks: "not an array" },
				"not a group",
			]),
		).toEqual([
			{
				matcher: "Bash",
				hooks: [
					{ type: "command", command: "node" },
					{
						type: "http",
						url: "https://hooks.example.test/h",
						headers: ["X-Key"],
					},
					"not a handler",
				],
			},
			{ hooks: "not an array" },
			"not a group",
		]));

	it("leaves other kinds and other shapes unchanged", () => {
		const permissions = { allow: ["Bash"], env: { A: "1" } };
		expect(hashInput("permissions", permissions)).toBe(permissions);
		expect(hashInput("mcp_server", ["x"])).toEqual(["x"]);
		expect(hashInput("hook", { env: { A: "1" } })).toEqual({ env: { A: "1" } });
	});
});
