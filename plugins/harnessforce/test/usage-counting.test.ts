import { appendFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { writeTree } from "@harnessforce/test-support/write-tree";
import { describe, expect, it } from "vitest";
import { runHook } from "../src/hook.js";
import {
	type Harness,
	harness,
	isUsageSummary,
	pluginData,
	REPO,
} from "./support.js";

// sessionのconfig snapshotに入る構成。userのskill、command、agent、MCP serverと、pluginのtools@acme。
function homeWithComponents(extra: Record<string, string> = {}) {
	const home = tempDir("hf-home-");
	const plugin = ".claude/plugins/cache/acme/tools/1.0.0/";
	writeTree(home, {
		".claude/skills/fix-ci/SKILL.md": "fix ci",
		".claude/commands/deploy.md": "deploy",
		".claude/agents/reviewer.md": "---\nname: reviewer\n---\n",
		".claude/agents/team/lead.md": "---\nname: lead\n---\n",
		".claude.json": JSON.stringify({
			mcpServers: {
				github: {},
				"acme.docs": {},
				"my.server": {},
				my_server: {},
			},
		}),
		".claude/settings.json": JSON.stringify({
			enabledPlugins: { "tools@acme": true },
		}),
		[`${plugin}skills/lint/SKILL.md`]: "lint",
		[`${plugin}skills/fix-ci/SKILL.md`]: "plugin fix ci",
		[`${plugin}commands/release.md`]: "release",
		[`${plugin}agents/auditor.md`]: "---\nname: auditor\n---\n",
		[`${plugin}.mcp.json`]: JSON.stringify({ mcpServers: { db: {} } }),
		...extra,
	});
	return home;
}

type Session = {
	event: (event: string, input?: Record<string, unknown>) => Promise<Harness>;
	summary: () => Promise<Record<string, unknown> | undefined>;
};

// Workspace用のkeyで始めたsession。eventの入力はhookが受け取るstdinのJSONである。
async function session(home = homeWithComponents()): Promise<Session> {
	const data = pluginData();
	const options = { env: { CLAUDE_PLUGIN_DATA: data }, homeDir: home };
	const event = async (name: string, input: Record<string, unknown> = {}) => {
		const h = harness(options);
		await runHook(
			name,
			JSON.stringify({ session_id: "s-1", cwd: REPO.cwd, ...input }),
			h.deps,
		);
		return h;
	};
	await event("session-start", { source: "startup" });
	return {
		event,
		summary: async () => {
			const end = await event("session-end");
			return end.bodiesTo("/v1/session-usage")[0]?.[0] as
				| Record<string, unknown>
				| undefined;
		},
	};
}

const skill = (name: unknown) => ({
	tool_name: "Skill",
	tool_input: { skill: name, args: "--fast" },
	tool_response: { success: true },
});
const subagent = (type: unknown, tool = "Agent") => ({
	tool_name: tool,
	tool_input: { subagent_type: type, prompt: "review the diff" },
	tool_response: { status: "completed" },
});
const mcp = (tool: string) => ({
	tool_name: tool,
	tool_input: { query: "repo:acme/web" },
	tool_response: { content: [] },
});
const command = (name: unknown, type = "slash_command") => ({
	expansion_type: type,
	command_name: name,
	command_args: "--prod",
	prompt: `/${name} --prod`,
});

describe("counting the session usage", () => {
	// correlation.md「受入条件」の要約の例。
	it("counts skills, MCP servers and commands by their configured identifiers, without bodies", async () => {
		const s = await session();
		await s.event("user-prompt-submit", {
			prompt_id: "p-1",
			prompt: "please fix the CI",
		});
		await s.event("post-tool-use", { prompt_id: "p-1", ...skill("fix-ci") });
		await s.event("post-tool-use", { prompt_id: "p-1", ...skill("fix-ci") });
		await s.event("post-tool-use", mcp("mcp__github__search_repositories"));
		await s.event("post-tool-use", mcp("mcp__github__search_repositories"));
		await s.event("post-tool-use-failure", {
			...mcp("mcp__github__get_file"),
			error: "not found: /etc/secret.txt",
		});
		await s.event("user-prompt-expansion", command("deploy"));
		const summary = await s.summary();
		expect(summary).toMatchObject({
			first_prompt_id: "p-1",
			skills: {
				items: [{ name: "fix-ci", calls: 2, failures: 0 }],
				other: { calls: 0, failures: 0 },
			},
			mcp_servers: {
				items: [{ name: "github", calls: 3, failures: 1 }],
				other: { calls: 0, failures: 0 },
			},
			commands: { items: [{ name: "deploy", calls: 1 }], other: { calls: 0 } },
		});
		expect(isUsageSummary(summary)).toBe(true);
		const sent = JSON.stringify(summary);
		for (const body of [
			"please fix the CI",
			"--fast",
			"--prod",
			"repo:acme/web",
			"/etc/secret.txt",
		])
			expect(sent).not.toContain(body);
	});

	it.each([
		["a skill name with a leading slash", skill("/fix-ci"), "fix-ci"],
		[
			"a plugin skill named with its plugin",
			skill("tools:lint"),
			"tools@acme:lint",
		],
		[
			"a plugin skill named without its plugin",
			skill("lint"),
			"tools@acme:lint",
		],
		["a skill that is also in a plugin", skill("fix-ci"), "fix-ci"],
	])("counts %s", async (_, input, name) => {
		const s = await session();
		await s.event("post-tool-use", input);
		expect((await s.summary())?.skills).toEqual({
			items: [{ name, calls: 1, failures: 0 }],
			other: { calls: 0, failures: 0 },
		});
	});

	it.each([
		["a skill that is not configured", skill("simplify")],
		["a skill input that is not a string", skill(42)],
		["a plugin skill of another plugin", skill("other:lint")],
	])("counts %s in other", async (_, input) => {
		const s = await session();
		await s.event("post-tool-use", input);
		expect((await s.summary())?.skills).toEqual({
			items: [],
			other: { calls: 1, failures: 0 },
		});
	});

	// correlation.md「名前から構成の識別子への対応」: 候補が2つ以上なら名前を特定できない。
	it("counts a plugin skill name shared by two plugins in other", async () => {
		const second = ".claude/plugins/cache/acme/more/1.0.0/";
		const s = await session(
			homeWithComponents({
				".claude/settings.json": JSON.stringify({
					enabledPlugins: { "tools@acme": true, "more@acme": true },
				}),
				[`${second}skills/lint/SKILL.md`]: "lint",
			}),
		);
		await s.event("post-tool-use", skill("lint"));
		expect((await s.summary())?.skills).toEqual({
			items: [],
			other: { calls: 1, failures: 0 },
		});
	});

	it.each([
		["the Agent tool", subagent("reviewer"), "reviewer"],
		["the Task tool", subagent("reviewer", "Task"), "reviewer"],
		["a plugin agent", subagent("tools:auditor"), "tools@acme:auditor"],
	])("counts a subagent started through %s", async (_, input, name) => {
		const s = await session();
		await s.event("post-tool-use", input);
		expect((await s.summary())?.subagents).toEqual({
			items: [{ name, calls: 1, failures: 0 }],
			other: { calls: 0, failures: 0 },
		});
	});

	it.each([
		["a built-in subagent", subagent("Explore")],
		// subagent_typeはfrontmatterのnameであり、識別子はfileのpath（team:lead）から作る。
		["an agent whose name differs from its file", subagent("lead")],
		["a subagent type that is not a string", subagent(undefined)],
	])("counts %s in other", async (_, input) => {
		const s = await session();
		await s.event("post-tool-use-failure", input);
		expect((await s.summary())?.subagents).toEqual({
			items: [],
			other: { calls: 1, failures: 1 },
		});
	});

	it.each([
		["a plugin server", "mcp__plugin_tools_db__query", "tools@acme:db"],
		[
			"a server with a replaced character",
			"mcp__acme_docs__search",
			"acme.docs",
		],
	])("counts the MCP tool of %s", async (_, tool, name) => {
		const s = await session();
		await s.event("post-tool-use", mcp(tool));
		expect((await s.summary())?.mcp_servers).toEqual({
			items: [{ name, calls: 1, failures: 0 }],
			other: { calls: 0, failures: 0 },
		});
	});

	it.each([
		["two servers with the same tool name", "mcp__my_server__query"],
		["a server that is not configured", "mcp__slack__post"],
	])("counts the MCP tool of %s in other", async (_, tool) => {
		const s = await session();
		await s.event("post-tool-use", mcp(tool));
		expect((await s.summary())?.mcp_servers).toEqual({
			items: [],
			other: { calls: 1, failures: 0 },
		});
	});

	// commandの`/<名前>`はskillも起動する。
	it.each([
		["a command", "deploy", "deploy"],
		["a skill typed as a command", "fix-ci", "fix-ci"],
		["a plugin command", "tools:release", "tools@acme:release"],
	])("counts %s typed by the user", async (_, name, id) => {
		const s = await session();
		await s.event("user-prompt-expansion", command(name));
		expect((await s.summary())?.commands).toEqual({
			items: [{ name: id, calls: 1 }],
			other: { calls: 0 },
		});
	});

	it("counts an MCP prompt as a command it cannot name", async () => {
		const s = await session();
		await s.event(
			"user-prompt-expansion",
			command("github:review", "mcp_prompt"),
		);
		expect((await s.summary())?.commands).toEqual({
			items: [],
			other: { calls: 1 },
		});
	});

	it("counts permission requests and compactions by trigger", async () => {
		const s = await session();
		await s.event("permission-request", {
			tool_name: "Bash",
			tool_input: { command: "rm -rf build" },
		});
		for (const trigger of ["auto", "auto", "manual", "resume"])
			await s.event("post-compact", {
				trigger,
				compact_summary: "the user asked for a refactor",
			});
		const summary = await s.summary();
		expect(summary).toMatchObject({
			permission_requests: 1,
			compactions: { auto: 2, manual: 1 },
		});
		expect(JSON.stringify(summary)).not.toContain("rm -rf");
		expect(JSON.stringify(summary)).not.toContain("refactor");
	});

	// correlation.md「数えるhook」: async hookのJSONの出力は次の番にClaudeへ渡るため、stdoutへ何も書かない。
	it.each([
		["post-tool-use", skill("fix-ci")],
		["post-tool-use-failure", mcp("mcp__github__x")],
		["user-prompt-expansion", command("deploy")],
		["permission-request", { tool_name: "Bash" }],
		["post-compact", { trigger: "auto" }],
	])("writes nothing on stdout from %s", async (event, input) => {
		const s = await session();
		const h = await s.event(event, input);
		expect(h.out()).toBe("");
		expect(h.err()).toBe("");
		expect(h.requests).toEqual([]);
	});

	it("counts nothing for a session without a record", async () => {
		const data = pluginData();
		const h = harness({ env: { CLAUDE_PLUGIN_DATA: data } });
		await runHook(
			"post-tool-use",
			JSON.stringify({ session_id: "s-1", cwd: REPO.cwd, ...skill("fix-ci") }),
			h.deps,
		);
		expect(h.out()).toBe("");
		expect(readdirSync(data)).toEqual([]);
	});

	// semantic-conventions.md「Session usage summary」: callsの多い順、同じならnameの順に200件まで。
	it("lists at most 200 names by calls and name, and adds the rest to other", async () => {
		const skills = Object.fromEntries(
			Array.from({ length: 202 }, (_, i) => [
				`.claude/skills/s${String(i).padStart(3, "0")}/SKILL.md`,
				"s",
			]),
		);
		const s = await session(homeWithComponents(skills));
		await s.event("post-tool-use", skill("s201"));
		await s.event("post-tool-use-failure", skill("s201"));
		for (let i = 0; i < 201; i++)
			await s.event("post-tool-use", skill(`s${String(i).padStart(3, "0")}`));
		const { items, other } = (await s.summary())?.skills as {
			items: { name: string; calls: number }[];
			other: unknown;
		};
		expect(items).toHaveLength(200);
		expect(items[0]).toEqual({ name: "s201", calls: 2, failures: 1 });
		expect(items.slice(1, 3).map((i) => i.name)).toEqual(["s000", "s001"]);
		expect(items.at(-1)?.name).toBe("s198");
		expect(other).toEqual({ calls: 2, failures: 0 });
	}, 30_000);

	it("skips lines of the record it cannot read", async () => {
		const data = pluginData();
		const h = harness({
			env: { CLAUDE_PLUGIN_DATA: data },
			homeDir: homeWithComponents(),
		});
		const run = (event: string, input: Record<string, unknown> = {}) =>
			runHook(
				event,
				JSON.stringify({ session_id: "s-1", cwd: REPO.cwd, ...input }),
				h.deps,
			);
		await run("session-start");
		appendFileSync(join(data, "usage/s-1.jsonl"), '{"kind":"skill"\n[]\n');
		await run("post-tool-use", skill("fix-ci"));
		await run("session-end");
		expect(h.bodiesTo("/v1/session-usage")[0]?.[0]).toMatchObject({
			skills: { items: [{ name: "fix-ci", calls: 1, failures: 0 }] },
		});
	});
});
