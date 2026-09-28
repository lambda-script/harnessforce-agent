import { tempDir } from "@harnessforce/test-support/temp-dir";
import { describe, expect, it } from "vitest";
import { components, fixture, hashValue, writeTree } from "./support.js";

const json = (value: unknown) => JSON.stringify(value, null, 2);

const PRE_TOOL = [
	{ matcher: "Bash", hooks: [{ type: "command", command: "x" }] },
];
const STOP = [{ hooks: [{ type: "command", command: "y" }] }];

describe("settings-based components", () => {
	it("collects hooks per event, permissions and model from each settings file", async () => {
		const f = fixture();
		f.home({
			".claude/settings.json": json({
				model: "claude-opus-5-5",
				permissions: { allow: ["Bash(git:*)"] },
				theme: "dark",
			}),
		});
		f.project({
			".claude/settings.json": json({
				hooks: { PreToolUse: PRE_TOOL, Stop: STOP },
			}),
			".claude/settings.local.json": json({
				permissions: { deny: ["WebFetch"] },
			}),
		});
		expect(await components(f.options)).toEqual([
			{
				kind: "hook",
				source: "repository",
				id: "PreToolUse",
				hash: hashValue(PRE_TOOL),
			},
			{ kind: "hook", source: "repository", id: "Stop", hash: hashValue(STOP) },
			{
				kind: "model",
				source: "user",
				id: "claude-opus-5-5",
				hash: hashValue("claude-opus-5-5"),
			},
			{
				kind: "permissions",
				source: "local",
				id: "permissions",
				hash: hashValue({ deny: ["WebFetch"] }),
			},
			{
				kind: "permissions",
				source: "user",
				id: "permissions",
				hash: hashValue({ allow: ["Bash(git:*)"] }),
			},
		]);
	});

	it("hashes settings values independent of key order and whitespace", async () => {
		const a = fixture();
		a.home({
			".claude/settings.json": '{"permissions":{"allow":["A"],"deny":["B"]}}',
		});
		const b = fixture();
		b.home({
			".claude/settings.json": json({
				permissions: { deny: ["B"], allow: ["A"] },
			}),
		});
		expect(await components(a.options)).toEqual(await components(b.options));
	});

	it("lets a later managed drop-in file replace a top-level key", async () => {
		const f = fixture();
		f.managed({
			"managed-settings.json": json({
				model: "base",
				permissions: { allow: [] },
			}),
			"managed-settings.d/20-model.json": json({ model: "override" }),
			"managed-settings.d/10-perm.json": json({ permissions: { deny: ["X"] } }),
			"managed-settings.d/notes.txt": "ignored",
		});
		expect(await components(f.options)).toEqual([
			{
				kind: "model",
				source: "managed",
				id: "override",
				hash: hashValue("override"),
			},
			{
				kind: "permissions",
				source: "managed",
				id: "permissions",
				hash: hashValue({ deny: ["X"] }),
			},
		]);
	});

	it("reads the user settings from CLAUDE_CONFIG_DIR", async () => {
		const configDir = tempDir("hf-config-dir-");
		writeTree(configDir, {
			"settings.json": json({ model: "from-config-dir" }),
		});
		const f = fixture({ CLAUDE_CONFIG_DIR: configDir });
		f.home({ ".claude/settings.json": json({ model: "from-home" }) });
		expect((await components(f.options)).map((c) => c.id)).toEqual([
			"from-config-dir",
		]);
	});

	it("skips unreadable settings and values of the wrong shape", async () => {
		const f = fixture();
		f.home({ ".claude/settings.json": "{ not json" });
		f.project({
			".claude/settings.json": json({
				model: 42,
				hooks: ["x"],
				permissions: "all",
			}),
			".claude/settings.local.json": json({ model: "has space" }),
			"CLAUDE.md": "still collected",
		});
		expect(
			(await components(f.options)).map((c) => `${c.kind}:${c.id}`),
		).toEqual(["rule:CLAUDE.md"]);
	});
});

describe("MCP servers", () => {
	const HTTP = {
		type: "http",
		url: "https://mcp.example.test",
		headers: { Authorization: "Bearer secret" },
	};
	const STDIO = { command: "npx", args: ["server"] };

	it("collects servers from every scope, hashing the entry", async () => {
		const f = fixture();
		f.managed({
			"managed-mcp.json": json({ mcpServers: { corp: HTTP } }),
			"managed-settings.json": json({
				managedMcpServers: { corp: STDIO, extra: STDIO },
			}),
		});
		f.project({ ".mcp.json": json({ mcpServers: { shared: STDIO } }) });
		f.home({});
		writeTree(f.options.homeDir, {
			".claude.json": json({
				mcpServers: { personal: HTTP },
				projects: {
					[f.options.projectRoot]: { mcpServers: { mine: STDIO } },
					"/elsewhere": { mcpServers: { other: STDIO } },
				},
			}),
		});
		expect(await components(f.options)).toEqual([
			{
				kind: "mcp_server",
				source: "local",
				id: "mine",
				hash: hashValue(STDIO),
			},
			{
				kind: "mcp_server",
				source: "managed",
				id: "corp",
				hash: hashValue(HTTP),
			},
			{
				kind: "mcp_server",
				source: "managed",
				id: "extra",
				hash: hashValue(STDIO),
			},
			{
				kind: "mcp_server",
				source: "repository",
				id: "shared",
				hash: hashValue(STDIO),
			},
			{
				kind: "mcp_server",
				source: "user",
				id: "personal",
				hash: hashValue(HTTP),
			},
		]);
	});

	it("does not read .claude.json when CLAUDE_CONFIG_DIR is set", async () => {
		const f = fixture({ CLAUDE_CONFIG_DIR: tempDir("hf-config-dir-") });
		writeTree(f.options.homeDir, {
			".claude.json": json({ mcpServers: { personal: HTTP } }),
		});
		expect(await components(f.options)).toEqual([]);
	});

	it("never exposes the server configuration, only its hash", async () => {
		const f = fixture();
		f.project({ ".mcp.json": json({ mcpServers: { shared: HTTP } }) });
		expect(JSON.stringify(await components(f.options))).not.toContain("secret");
	});
});
