import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// CIはmodelを呼ばないため、`claude plugin eval`が読み込みで落とす形の誤りと、suiteの網羅をここで検査する。
const pluginDir = fileURLToPath(
	new URL("../plugins/harnessforce/", import.meta.url),
);
const evalDir = join(pluginDir, "evals");
const mockDir = join(evalDir, "mocks/harnessforce");

// claude plugin evalのprompt.mdとgraderのfrontmatterが受け付けるkey（https://code.claude.com/docs/en/plugin-evals）。
const PROMPT_KEYS = new Set([
	"schema_version",
	"name",
	"description",
	"tags",
	"plugins",
	"runs",
	"expected_outcome",
	"model",
	"max_turns",
	"timeout_seconds",
	"allowed_tools",
	"append_system_prompt",
	"env",
]);
const GRADER_KEYS: Record<string, string[]> = {
	regex: ["pattern", "flags", "match", "target"],
	tool_used: ["tool", "input_match", "min", "max"],
	tool_order: ["before", "after"],
	file_exists: ["path", "exists"],
	llm: ["criteria", "focus"],
	baseline: ["baseline_file", "criteria"],
};
const COMMON_GRADER_KEYS = ["type", "weight", "arm"];
// trigger: 1つの腕で発火を測る。rules: 読み取りのtoolだけで2つの腕を比べる。granted: Bash、Write、Editを与えて2つの腕を比べる。
const TAGS = new Set(["trigger", "rules", "granted"]);
// standaloneのmockはplugin名を含まない名前で登録される。
const MCP_PREFIX = "mcp__harnessforce__";

type Frontmatter = Record<string, unknown>;

function frontmatterOf(path: string): { data: Frontmatter; body: string } {
	const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(
		readFileSync(path, "utf8"),
	);
	if (!match) throw new Error(`${path} has no frontmatter`);
	return { data: parse(match[1] ?? "") ?? {}, body: match[2] ?? "" };
}

function caseDirs(dir: string): string[] {
	if (existsSync(join(dir, "prompt.md"))) return [dir];
	return readdirSync(dir, { withFileTypes: true })
		.filter(
			(e) => e.isDirectory() && e.name !== "mocks" && e.name !== "results",
		)
		.flatMap((e) => caseDirs(join(dir, e.name)));
}

const cases = caseDirs(evalDir).map((dir) => {
	const prompt = frontmatterOf(join(dir, "prompt.md"));
	const graders = readdirSync(join(dir, "graders")).map((file) => ({
		name: basename(file, ".md"),
		...frontmatterOf(join(dir, "graders", file)),
	}));
	return { id: relative(evalDir, dir), dir, prompt, graders };
});
const mockedTools = readdirSync(mockDir)
	.filter((f) => f.endsWith(".md"))
	.map((f) => basename(f, ".md"));
const toolSchemas: {
	name: string;
	inputSchema: { properties: Record<string, unknown> };
}[] = JSON.parse(readFileSync(join(mockDir, "_tools.json"), "utf8")).tools;
const skills = readdirSync(join(pluginDir, "skills"));

const skillOf = (grader: Frontmatter) =>
	/\(\?:\[\\w-\]\+:\)\?([\w-]+)"/.exec(String(grader.input_match))?.[1];
const triggerCases = cases.filter((c) =>
	((c.prompt.data.tags as string[] | undefined) ?? []).includes("trigger"),
);
const mocks = mockedTools.map((tool) => ({
	tool,
	...frontmatterOf(join(mockDir, `${tool}.md`)),
}));
const MOCK_KEYS = ["type", "expect", "error", "abort_when"];
// expectの`/.../`は独自のdialectで、groupと選言を持つとcaseが読み込めず0点になる。
const UNSUPPORTED_EXPECT_REGEX = /[()|]/;
const expectRegex = (value: string) =>
	new RegExp(value.slice(1, value.lastIndexOf("/")));

describe("plugin eval cases", () => {
	it("finds the suite", () => expect(cases.length).toBeGreaterThan(0));

	it.each(cases)("$id has a prompt and known frontmatter", (c) => {
		expect(c.prompt.body.trim()).not.toBe("");
		expect(
			Object.keys(c.prompt.data).filter((k) => !PROMPT_KEYS.has(k)),
		).toEqual([]);
		expect(String(c.prompt.data.description ?? "")).not.toBe("");
		const tags = c.prompt.data.tags as string[];
		expect(tags).toHaveLength(1);
		expect(TAGS.has(tags[0] ?? "")).toBe(true);
	});

	// 先頭の`/`はslash commandとして実行され、skillの発火も規則も測れなくなる。
	it.each(cases)("$id does not start the prompt with a slash command", (c) =>
		expect(c.prompt.body.trimStart().startsWith("/")).toBe(false),
	);

	it.each(cases)("$id has the scaffold script it names", (c) => {
		const caseYaml = join(c.dir, "case.yaml");
		if (!existsSync(caseYaml)) return;
		const script = parse(readFileSync(caseYaml, "utf8")).context
			?.scaffold_script;
		if (script !== undefined)
			expect(existsSync(join(c.dir, script))).toBe(true);
	});

	it.each(cases)("$id has graders of known types and options", (c) => {
		expect(c.graders.length).toBeGreaterThan(0);
		for (const g of c.graders) {
			const type = String(g.data.type);
			expect(Object.keys(GRADER_KEYS), `${g.name}: type`).toContain(type);
			expect(
				Object.keys(g.data).filter(
					(k) =>
						!COMMON_GRADER_KEYS.includes(k) &&
						!(GRADER_KEYS[type] ?? []).includes(k),
				),
				`${g.name}: unknown keys`,
			).toEqual([]);
			for (const key of ["pattern", "input_match"])
				if (g.data[key] !== undefined)
					expect(() => new RegExp(String(g.data[key]))).not.toThrow();
		}
	});

	// mockの無いMCPのtoolはrunで使えないため、そのtoolを見るgraderは何も測らない。
	it.each(cases)("$id grades only Harnessforce tools that are mocked", (c) => {
		const tools = c.graders.flatMap((g) => [
			g.data.tool,
			g.data.before,
			g.data.after,
		]);
		for (const tool of tools)
			if (typeof tool === "string" && tool.startsWith("mcp__"))
				expect(mockedTools).toContain(tool.slice(MCP_PREFIX.length));
	});

	// `arm: both`が効くのは採点から外れるgrader（`tool: Skill`）だけだが、「呼ばれない」検査はすべて
	// 両方の腕で採点する意図を明示するため、一律に付ける。
	it.each(cases)("$id asserts absence in both arms", (c) => {
		for (const g of c.graders)
			if (g.data.type === "tool_used" && g.data.max === 0)
				expect(g.data.arm, g.name).toBe("both");
	});

	// 発火の誤りは、呼ばれるべきpromptと、近いが呼ばれるべきでないpromptの両方で測る。
	// using-harnessforceはSessionStartのhookが文脈へ入れるため、modelが選ぶskillではない。
	// setupは副作用を持つcommandであり、modelが選べるため、skillと同じく組で測る。
	it.each([...skills.filter((s) => s !== "using-harnessforce"), "setup"])(
		"%s has trigger cases that should and should not invoke it",
		(skill) => {
			const graders = triggerCases.flatMap((c) =>
				c.graders.filter((g) => skillOf(g.data) === skill),
			);
			expect(graders.some((g) => g.data.max === undefined)).toBe(true);
			expect(graders.some((g) => g.data.max === 0)).toBe(true);
		},
	);

	it("keeps each trigger case to one Skill grader", () => {
		for (const c of triggerCases) {
			expect(c.graders, c.id).toHaveLength(1);
			expect(c.graders[0]?.data.tool, c.id).toBe("Skill");
			expect(skillOf(c.graders[0]?.data ?? {}), c.id).toBeDefined();
		}
	});

	it("names only skills and commands of the plugin in trigger graders", () => {
		const commands = readdirSync(join(pluginDir, "commands")).map((f) =>
			basename(f, ".md"),
		);
		for (const c of triggerCases)
			expect([...skills, ...commands], c.id).toContain(
				skillOf(c.graders[0]?.data ?? {}),
			);
	});

	// #112: list_issuesの`q`は、今のstatusの語彙だけを使う。
	it("keeps the regression case of the list_issues query", () => {
		const regression = cases.find(
			(c) => c.id === "record-session/lists-candidates-without-issue",
		);
		expect(regression).toBeDefined();
		const guard = mocks.find((m) => m.tool === "list_issues")?.data
			.expect as Record<string, string>;
		expect(guard.sort).toBe("updated");
		const q = expectRegex(guard.q ?? "");
		expect(q.test("-status:resolved,not_planned export")).toBe(true);
		expect(q.test("-status:done,canceled export")).toBe(false);
		expect(q.test("-status:resolved,not_planned ")).toBe(false);
		expect(q.test("export")).toBe(false);
	});
});

describe("Harnessforce MCP mocks", () => {
	it("serves each mocked tool with its schema", () =>
		expect(toolSchemas.map((t) => t.name).sort()).toEqual(
			[...mockedTools].sort(),
		));

	it.each(mocks)("$tool guards only fields of its input schema", (m) => {
		expect(Object.keys(m.data).filter((k) => !MOCK_KEYS.includes(k))).toEqual(
			[],
		);
		const schema = toolSchemas.find((t) => t.name === m.tool);
		for (const [field, value] of Object.entries(
			(m.data.expect ?? {}) as Record<string, unknown>,
		)) {
			expect(Object.keys(schema?.inputSchema.properties ?? {})).toContain(
				field,
			);
			if (typeof value === "string" && value.startsWith("/"))
				expect(value, field).not.toMatch(UNSUPPORTED_EXPECT_REGEX);
		}
	});
});
