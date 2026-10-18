import { tempDir } from "@harnessforce/test-support/temp-dir";
import { writeTree } from "@harnessforce/test-support/write-tree";
import { describe, expect, it } from "vitest";
import { components, fixture, hashValue } from "./support.js";

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

	it("keeps the hook hash when only an http hook header value changes, not when a command changes", async () => {
		const hashOf = async (hook: Record<string, unknown>) => {
			const f = fixture();
			f.project({
				".claude/settings.json": json({ hooks: { Stop: [{ hooks: [hook] }] } }),
			});
			return (await components(f.options))[0]?.hash;
		};
		const http = { type: "http", url: "https://hooks.example.test/h" };
		expect(await hashOf({ ...http, headers: { "X-Key": "one" } })).toBe(
			await hashOf({ ...http, headers: { "X-Key": "two" } }),
		);
		expect(await hashOf({ type: "command", command: "a" })).not.toBe(
			await hashOf({ type: "command", command: "b" }),
		);
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
	// correlation.md「構成の収集」: headersの値とargsはhashに入れない。
	const HTTP_HASHED = {
		type: "http",
		url: "https://mcp.example.test/",
		headers: ["Authorization"],
	};
	const STDIO_HASHED = { command: "npx" };

	it("collects servers from every scope, hashing the entry without secret-bearing values", async () => {
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
				hash: hashValue(STDIO_HASHED),
			},
			{
				kind: "mcp_server",
				source: "managed",
				id: "corp",
				hash: hashValue(HTTP_HASHED),
			},
			{
				kind: "mcp_server",
				source: "managed",
				id: "extra",
				hash: hashValue(STDIO_HASHED),
			},
			{
				kind: "mcp_server",
				source: "repository",
				id: "shared",
				hash: hashValue(STDIO_HASHED),
			},
			{
				kind: "mcp_server",
				source: "user",
				id: "personal",
				hash: hashValue(HTTP_HASHED),
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

	it("keeps the hash when only header, env, args or URL credential values change", async () => {
		const hashOf = async (servers: Record<string, unknown>) => {
			const f = fixture();
			f.project({ ".mcp.json": json({ mcpServers: servers }) });
			return (await components(f.options)).map((c) => c.hash);
		};
		const before = await hashOf({
			http: { ...HTTP, url: "https://a:b@mcp.example.test/?k=1" },
			stdio: { ...STDIO, env: { DB_PASSWORD: "one" } },
		});
		expect(
			await hashOf({
				http: {
					...HTTP,
					url: "https://c:d@mcp.example.test/?k=2",
					headers: { Authorization: "Bearer other" },
				},
				stdio: {
					command: "npx",
					args: ["--pw", "x"],
					env: { DB_PASSWORD: "two" },
				},
			}),
		).toEqual(before);
		const [httpBefore, stdioBefore] = before;
		const changed = async (servers: Record<string, unknown>) => {
			const after = await hashOf(servers);
			expect(after[0]).not.toBe(httpBefore);
			expect(after[1]).not.toBe(stdioBefore);
		};
		await changed({
			http: { ...HTTP, url: "https://mcp.example.test/other" },
			stdio: { ...STDIO, env: { DB_PASSWORD: "one", EXTRA: "" } },
		});
		await changed({
			http: { ...HTTP, url: "https://other.example.test/" },
			stdio: { ...STDIO, command: "node", env: { DB_PASSWORD: "one" } },
		});
		await changed({
			http: { ...HTTP, headers: { Authorization: "Bearer secret", X: "" } },
			stdio: { command: "npx" },
		});
	});

	it("never exposes the server configuration, only its hash", async () => {
		const f = fixture();
		f.project({ ".mcp.json": json({ mcpServers: { shared: HTTP } }) });
		expect(JSON.stringify(await components(f.options))).not.toContain("secret");
	});
});
