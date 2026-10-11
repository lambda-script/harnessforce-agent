import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = { uses?: string; run?: string; with?: Record<string, unknown> };
type Job = {
	"runs-on": string;
	strategy?: {
		"fail-fast"?: boolean;
		matrix: { include: Record<string, unknown>[] };
	};
	steps: Step[];
};

const workflowsDir = new URL("../.github/workflows/", import.meta.url);
const workflow = (name: string) =>
	parse(readFileSync(new URL(name, workflowsDir), "utf8")) as {
		jobs: Record<string, Job>;
	};
const ci = workflow("ci.yml");
const runs = (job: Job) => job.steps.flatMap((step) => step.run ?? []);
const setupNodes = (job: Job) =>
	job.steps.filter((step) => step.uses?.startsWith("actions/setup-node@"));

// hooks.jsonが起動するentry。plugins/harnessforce/build.mjsのmarketplace出力と一致させる。
const HOOK_ENTRY =
	"plugins/harnessforce/dist/marketplace/plugins/harnessforce/scripts/harnessforce-hook.cjs";

describe("ci workflow", () => {
	it("runs the full check on ubuntu with the pinned Node.js", () => {
		const check = ci.jobs.check as Job;
		expect(check["runs-on"]).toMatch(/^ubuntu-/);
		expect(setupNodes(check)[0]?.with).toMatchObject({
			"node-version-file": ".node-version",
		});
		expect(runs(check)).toContain("pnpm check");
	});

	it("tests the cli, the plugin and their shared core on macOS, Windows and Node.js 24", () => {
		const test = ci.jobs.test as Job;
		expect(test.strategy?.["fail-fast"]).toBe(false);
		expect(test.strategy?.matrix.include).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ os: "macos-latest" }),
				expect.objectContaining({ os: "windows-latest" }),
				expect.objectContaining({
					os: expect.stringMatching(/^ubuntu-/),
					node: 24,
				}),
			]),
		);
		expect(runs(test)).toContainEqual(
			expect.stringMatching(
				/^pnpm turbo run test --filter=@harnessforce\/agent-core --filter=@harnessforce\/cli --filter=harnessforce-plugin$/,
			),
		);
	});

	// correlation.md「実行環境」: hookは端末のNode.js 18以上で動き、harnessforceも同じNode.jsで起動される。
	describe("Node.js 18 runtime smoke", () => {
		const smoke = ci.jobs["node18-runtime"] as Job;
		const commands = () => runs(smoke).join("\n");

		it("runs the built artifacts on Node.js 18 after building them", () => {
			const lastSetup = setupNodes(smoke).at(-1);
			expect(lastSetup?.with).toMatchObject({ "node-version": 18 });
			const buildIndex = smoke.steps.findIndex((step) =>
				step.run?.startsWith("pnpm turbo run build"),
			);
			expect(buildIndex).toBeGreaterThan(-1);
			expect(smoke.steps.indexOf(lastSetup as Step)).toBeGreaterThan(
				buildIndex,
			);
		});

		it("starts the built harnessforce", () =>
			expect(commands()).toContain("node packages/cli/dist/bin.js --version"));

		it("runs the hook entry on empty and invalid stdin", () => {
			expect(commands()).toContain(
				`node ${HOOK_ENTRY} session-start < /dev/null`,
			);
			expect(commands()).toContain(`| node ${HOOK_ENTRY} user-prompt-submit`);
		});
	});
});

describe("workflow actions", () => {
	const files = readdirSync(workflowsDir).filter((file) =>
		file.endsWith(".yml"),
	);
	// tagは付け替えられるため、第三者のactionはcommitのSHAで固定する。
	it.each(files)("%s pins every action by commit SHA", (file) => {
		const uses = Object.values(workflow(file).jobs).flatMap((job) =>
			job.steps.flatMap((step) => step.uses ?? []),
		);
		expect(uses.length).toBeGreaterThan(0);
		for (const action of uses) expect(action).toMatch(/@[0-9a-f]{40}$/);
	});
});
