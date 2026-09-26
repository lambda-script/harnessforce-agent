import { describe, expect, it } from "vitest";
import { collectConfig } from "../../src/config/collect.js";
import { fileHash, fixture, hashValue, tempDir, writeTree } from "./support.js";

async function components(options: Parameters<typeof collectConfig>[0]) {
	const result = await collectConfig(options);
	if (result.kind !== "collected") throw new Error(result.reason);
	return result.components;
}

const json = (value: unknown) => JSON.stringify(value);
const SESSION_START = [{ hooks: [{ type: "command", command: "node" }] }];
const API = { type: "http", url: "https://api.example.test/mcp" };

const PLUGIN_FILES = {
	"skills/ship/SKILL.md": "ship",
	"agents/review/security.md": "sec",
	"commands/status.md": "status",
	"workflows/audit.js": "audit",
	"hooks/hooks.json": json({
		description: "x",
		hooks: { SessionStart: SESSION_START },
	}),
	".mcp.json": json({ mcpServers: { api: API } }),
	"CLAUDE.md": "not loaded as context",
};

const enable = (plugins: Record<string, boolean>) =>
	json({ enabledPlugins: plugins });

describe("plugin components", () => {
	it("collects an enabled plugin's components from its cached version", async () => {
		const f = fixture();
		f.home({ ".claude/settings.json": enable({ "deploy@acme": true }) });
		writeTree(
			f.options.homeDir,
			prefix(".claude/plugins/cache/acme/deploy/1.2.0/", PLUGIN_FILES),
		);
		const plugin = (kind: string, id: string, hash: string) => ({
			kind,
			source: "plugin",
			id: `deploy@acme:${id}`,
			version: "1.2.0",
			hash,
		});
		expect(await components(f.options)).toEqual([
			plugin("agent", "review:security", fileHash("sec")),
			plugin("command", "status", fileHash("status")),
			plugin("hook", "SessionStart", hashValue(SESSION_START)),
			plugin("mcp_server", "api", hashValue(API)),
			plugin("skill", "ship", fileHash("ship")),
			plugin("workflow", "audit", fileHash("audit")),
		]);
	});

	it("uses the value from the highest settings source per plugin", async () => {
		const f = fixture();
		f.home({
			".claude/settings.json": enable({
				"a@m": true,
				"b@m": true,
				"c@m": false,
			}),
		});
		f.project({
			".claude/settings.json": enable({ "c@m": true }),
			".claude/settings.local.json": enable({ "a@m": false }),
		});
		f.managed({
			"managed-settings.json": enable({ "b@m": false, "d@m": true }),
		});
		for (const name of ["a", "b", "c", "d"])
			writeTree(f.options.homeDir, {
				[`.claude/plugins/cache/m/${name}/1.0.0/commands/x.md`]: name,
			});
		expect((await components(f.options)).map((c) => c.id)).toEqual([
			"c@m:x",
			"d@m:x",
		]);
	});

	it("ignores orphaned versions and skips plugins without exactly one live version", async () => {
		const f = fixture();
		f.home({
			".claude/settings.json": enable({
				"one@m": true,
				"two@m": true,
				"none@m": true,
			}),
		});
		writeTree(f.options.homeDir, {
			".claude/plugins/cache/m/one/1.0.0/commands/x.md": "old",
			".claude/plugins/cache/m/one/1.0.0/.orphaned_at": "2026-09-01",
			".claude/plugins/cache/m/one/2.0.0/commands/x.md": "new",
			".claude/plugins/cache/m/two/1.0.0/commands/x.md": "a",
			".claude/plugins/cache/m/two/1.1.0/commands/x.md": "b",
			".claude/plugins/cache/m/none/1.0.0/.orphaned_at": "2026-09-01",
		});
		expect(await components(f.options)).toEqual([
			{
				kind: "command",
				source: "plugin",
				id: "one@m:x",
				version: "2.0.0",
				hash: fileHash("new"),
			},
		]);
	});

	it.each([
		"x@inline",
		"x@skills-dir",
		"x@synced",
		"no-marketplace",
		"@m",
		"x@",
	])("does not collect %s", async (id) => {
		const f = fixture();
		f.home({ ".claude/settings.json": enable({ [id]: true }) });
		writeTree(f.options.homeDir, {
			".claude/plugins/cache/inline/x/1.0.0/commands/c.md": "c",
			".claude/plugins/cache/skills-dir/x/1.0.0/commands/c.md": "c",
			".claude/plugins/cache/synced/x/1.0.0/commands/c.md": "c",
		});
		expect(await components(f.options)).toEqual([]);
	});

	it("omits a version that is not a token", async () => {
		const f = fixture();
		f.home({ ".claude/settings.json": enable({ "p@m": true }) });
		writeTree(f.options.homeDir, {
			".claude/plugins/cache/m/p/v 1/commands/x.md": "x",
		});
		expect(await components(f.options)).toEqual([
			{ kind: "command", source: "plugin", id: "p@m:x", hash: fileHash("x") },
		]);
	});

	it.each([
		[
			"CLAUDE_CODE_PLUGIN_CACHE_DIR",
			(dir: string) => ({ CLAUDE_CODE_PLUGIN_CACHE_DIR: dir }),
			"",
		],
		[
			"CLAUDE_CONFIG_DIR",
			(dir: string) => ({ CLAUDE_CONFIG_DIR: dir }),
			"plugins/",
		],
	])("finds the plugins root through %s", async (_, env, sub) => {
		const dir = tempDir("hf-plugins-");
		writeTree(dir, {
			"settings.json": enable({ "p@m": true }),
			[`${sub}cache/m/p/1.0.0/commands/x.md`]: "x",
		});
		const f = fixture(env(dir));
		f.project({ ".claude/settings.json": enable({ "p@m": true }) });
		expect((await components(f.options)).map((c) => c.id)).toEqual(["p@m:x"]);
	});
});

function prefix(base: string, files: Record<string, string>) {
	return Object.fromEntries(
		Object.entries(files).map(([path, content]) => [`${base}${path}`, content]),
	);
}
