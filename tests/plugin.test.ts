import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const read = (p: string) =>
	JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));

describe("plugin skeleton", () => {
	const marketplace = read(".claude-plugin/marketplace.json");
	const plugin = read("plugins/harnessforce/.claude-plugin/plugin.json");

	it("matches the install command in onboarding (harnessforce@harnessforce-agent)", () => {
		expect(marketplace.name).toBe("harnessforce-agent");
		expect(marketplace.plugins).toEqual([
			expect.objectContaining({
				name: "harnessforce",
				source: "./plugins/harnessforce",
			}),
		]);
		expect(plugin.name).toBe("harnessforce");
	});

	it("points the marketplace source at an existing plugin directory", () =>
		expect(
			existsSync(
				new URL(
					"../plugins/harnessforce/.claude-plugin/plugin.json",
					import.meta.url,
				),
			),
		).toBe(true));

	// hookのscriptはbuildの出力（plugins/harnessforce/dist/marketplace）にだけある。repositoryから直接導入しても存在しないscriptを起動しない。
	it("wires no hooks in the repository copy of the plugin", () =>
		expect(read("plugins/harnessforce/hooks/hooks.json")).toEqual({
			hooks: {},
		}));

	// MCP serverのURLはbuildの入力から作るため、buildの出力にだけ宣言する（correlation.md「接続先」）。
	it("declares no MCP server in the repository copy of the plugin", () =>
		expect(
			existsSync(new URL("../plugins/harnessforce/.mcp.json", import.meta.url)),
		).toBe(false));

	it("declares the public license and repository", () => {
		expect(plugin.license).toBe("Apache-2.0");
		expect(plugin.repository).toBe(
			"https://github.com/lambda-script/harnessforce-agent",
		);
	});
});

const readText = (p: string) =>
	readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

function splitFrontmatter(markdown: string) {
	const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(markdown);
	if (!match) throw new Error("no frontmatter");
	return { frontmatter: parse(match[1] as string), body: match[2] as string };
}

const indexesOf = (text: string, words: string[]) =>
	words.map((word) => text.indexOf(word));

// correlation.md「MCP」: pluginに同梱し、agentへMCPのtoolの手順を示す。Agent Skillsの形式で書く。
describe("run recording skill", () => {
	const { frontmatter, body } = splitFrontmatter(
		readText("plugins/harnessforce/skills/record-run/SKILL.md"),
	);

	it("follows the Agent Skills frontmatter rules", () => {
		expect(frontmatter.name).toBe("record-run");
		expect(frontmatter.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
		expect(typeof frontmatter.description).toBe("string");
		expect(frontmatter.description.length).toBeGreaterThan(0);
		expect(frontmatter.description.length).toBeLessThanOrEqual(1024);
	});

	it("walks the agent through the MCP tools in the order of the spec", () => {
		const positions = indexesOf(body, [
			"`start_run`",
			"`get_issue`",
			"`record_plan`",
			"`record_decision`",
			"`complete_run`",
		]);
		expect(positions.every((position) => position >= 0)).toBe(true);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
	});

	it("passes the session_id from the context to start_run", () =>
		expect(body).toMatch(/`session_id`[^\n]*`start_run`/));

	it("records a plan only when neither a current nor a proposed plan exists", () =>
		expect(body).toMatch(/現行のPlanも`proposed`のPlanも無/));

	it("reports each Definition of Done item as met or unmet", () => {
		expect(body).toContain("`met`");
		expect(body).toContain("`unmet`");
	});

	it("tells the agent that its records stay proposed until a person approves them", () =>
		expect(body).toMatch(/`proposed`[^\n]*承認/));
});

// onboarding.md「チェックリスト」の手順4「自分の端末で設定する」。
describe("setup command", () => {
	const { frontmatter, body } = splitFrontmatter(
		readText("plugins/harnessforce/commands/setup.md"),
	);
	const NODE_REQUIRED =
		"pluginのhookにはNode.js 18以上が必要です。Node.jsを導入してからClaude Codeを再起動し、もう一度`/harnessforce:setup`を実行してください";

	it("describes itself for the command list", () =>
		expect(frontmatter.description).toEqual(expect.any(String)));

	it("checks Node.js 18 first and stops with the onboarding message", () => {
		expect(body).toContain("`node --version`");
		expect(body).toContain("18未満");
		expect(body).toContain(NODE_REQUIRED);
		expect(body.indexOf("`node --version`")).toBeLessThan(
			body.indexOf("npm install -g"),
		);
	});

	// publicの経路: 公開したCLIをnpmから導入する（environments.md「接続先」）。
	it("installs the published CLI from npm in the repository copy", () =>
		expect(body).toContain("npm install -g @harnessforce/cli"));

	it("runs hf init and hf import, then asks for a restart before confirming the first event", () => {
		// 導入より前には、Node.jsの文言と再起動後の判定がこれらの語を含む。
		const afterInstall = body.slice(body.indexOf("npm install -g"));
		const positions = indexesOf(afterInstall, [
			"`hf init`",
			"`hf import`",
			"再起動",
			"最初のイベント",
		]);
		expect(positions.every((position) => position >= 0)).toBe(true);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
	});
});
