import { managedDir } from "@harnessforce/test-support/managed-dir";
import { describe, expect, it } from "vitest";
import { createImportGit } from "../../src/import/repository.js";
import type { CliDeps } from "../../src/main.js";
import {
	gitRepository,
	initializedHome,
	initializedKeychain,
	NOW,
	startImportServer,
} from "../import/harness.js";
import { runCli } from "../support/cli.js";

const STATUS_FAILED =
	"Could not read the Harnessforce status. Run `harnessforce init` and try again.\n";
const EXPIRED = "Your login has expired. Run `harnessforce init`\n";

const step = (n: number, status: string) => ({
	step: n,
	status,
	url: `https://app.example.test/en/w/acme/step-${n}`,
});

const OWNER = {
	workspace_name: "Acme",
	role: "owner",
	has_seat: true,
	steps: [
		step(2, "done"),
		step(3, "todo"),
		step(4, "unavailable"),
		step(5, "todo"),
	],
};

async function setup(
	options: Parameters<typeof startImportServer>[0] = {},
	cwd: string = gitRepository(),
) {
	const hf = await startImportServer({
		onboarding: { status: 200, body: OWNER },
		...options,
	});
	const home = initializedHome({
		HARNESSFORCE_URL: hf.appUrl,
		HARNESSFORCE_ENDPOINT: `${hf.ingestUrl}/`,
		HARNESSFORCE_WORKSPACE_ID: "ws1",
	});
	const keychain = initializedKeychain(hf.origin);
	const run = (argv: string[] = [], deps: Partial<CliDeps> = {}) =>
		runCli(["status", ...argv], {
			defaultUrl: "https://default.example.test",
			now: () => new Date(NOW),
			homeDir: home.home,
			managedDir: managedDir(null),
			keychain: keychain.keychain,
			cwd,
			importGit: createImportGit(process.platform, process.env, process.cwd()),
			...deps,
		});
	return { hf, run };
}

// onboarding.md「harnessforce status」。
describe("harnessforce status", () => {
	it("prints the workspace, each step and whether this repository is assigned to a project", async () => {
		const { run } = await setup();
		const result = await run();
		expect(result.code).toBe(0);
		expect(result.out).toBe(
			[
				"Acme (owner)",
				"✓ Connect the GitHub App",
				"・ Assign repositories to a project https://app.example.test/en/w/acme/step-3",
				"? Set up telemetry",
				"・ Wait for your first session https://app.example.test/en/w/acme/step-5",
				"This repository (github.com/acme/web) is assigned to a project",
				"",
			].join("\n"),
		);
	});

	it("says the repository is not assigned to a project when the repository list does not have it", async () => {
		const { run } = await setup({
			repositories: () => ({
				status: 200,
				body: {
					items: [{ repository: "github.com/acme/api" }],
					next_cursor: null,
				},
			}),
		});
		const result = await run();
		expect(result.code).toBe(0);
		expect(result.out).toContain(
			"This repository (github.com/acme/web) is not assigned to a project\n",
		);
	});

	it("prints the onboarding response with the repository as one JSON object for --json", async () => {
		const { run } = await setup({
			repositories: () => ({
				status: 200,
				body: {
					items: [{ repository: "github.com/acme/api" }],
					next_cursor: null,
				},
			}),
		});
		const result = await run(["--json"]);
		expect(result.code).toBe(0);
		expect(JSON.parse(result.out)).toEqual({
			...OWNER,
			repository: { name: "github.com/acme/web", connected: false },
			outdated_agents: [],
		});
	});

	it("matches the repository against aliases on every page of the repository list", async () => {
		const { run } = await setup({
			repositories: (cursor) => ({
				status: 200,
				body:
					cursor === null
						? {
								items: [{ repository: "github.com/acme/api" }],
								next_cursor: "c1",
							}
						: {
								items: [{ repository: "github.com/acme/web" }],
								next_cursor: null,
							},
			}),
		});
		const result = await run(["--json"]);
		expect(JSON.parse(result.out).repository).toEqual({
			name: "github.com/acme/web",
			connected: true,
		});
	});

	it("shows the unfinished admin steps to a Member in step order", async () => {
		const { run } = await setup({
			onboarding: {
				status: 200,
				body: {
					workspace_name: "Acme",
					role: "member",
					has_seat: true,
					steps: [step(4, "done"), step(5, "todo")],
					admin_steps: [step(2, "todo")],
				},
			},
		});
		const result = await run();
		expect(result.out).toBe(
			[
				"Acme (member)",
				"・ Connect the GitHub App https://app.example.test/en/w/acme/step-2",
				"✓ Set up telemetry",
				"・ Wait for your first session https://app.example.test/en/w/acme/step-5",
				"This repository (github.com/acme/web) is assigned to a project",
				"",
			].join("\n"),
		);
	});

	it("leaves the repository null outside a git repository and does not send the remote URL", async () => {
		const { hf, run } = await setup({}, "/nonexistent/hf-not-a-repo");
		const result = await run(["--json"]);
		expect(result.code).toBe(0);
		expect(JSON.parse(result.out).repository).toBeNull();
		const text = await run();
		expect(text.out).not.toContain("This repository");
		expect(JSON.stringify(hf.requests)).not.toContain("Acme/Web");
	});

	it("leaves the repository null when the repository has no origin remote", async () => {
		const { run } = await setup(
			{},
			gitRepository("git@github.com:Acme/Web.git", "upstream"),
		);
		const result = await run(["--json"]);
		expect(JSON.parse(result.out).repository).toBeNull();
	});

	it("exits 0 for a Viewer with no steps", async () => {
		const { run } = await setup({
			onboarding: {
				status: 200,
				body: {
					workspace_name: "Acme",
					role: "viewer",
					has_seat: false,
					steps: [],
				},
			},
		});
		const result = await run();
		expect(result.code).toBe(0);
		expect(result.out.split("\n")[0]).toBe("Acme (viewer)");
	});

	// onboarding.md「harnessforce status」とcorrelation.md「agentの版」: 古いagentごとに1行、--jsonではoutdated_agents。
	describe("agent versions", () => {
		const versions =
			(outputs: Record<string, string | undefined>): CliDeps["agentVersion"] =>
			async (agent) =>
				outputs[agent];
		const CLAUDE_OLD =
			"Claude Code 2.1.100 is older than 2.1.214, the oldest version the Harnessforce hooks support. Update Claude Code.";
		const CODEX_OLD =
			"Codex 0.147.3 is older than 0.148.0, the oldest version the Harnessforce hooks support. Update Codex.";

		it("adds a line for each agent older than the oldest version the hooks support, Claude Code first", async () => {
			const { run } = await setup();
			const result = await run([], {
				agentVersion: versions({
					claude: "2.1.100 (Claude Code)\n",
					codex: "codex-cli 0.147.3\n",
				}),
			});
			expect(result.code).toBe(0);
			expect(result.out.split("\n").slice(-3)).toEqual([
				CLAUDE_OLD,
				CODEX_OLD,
				"",
			]);
		});

		it("lists the outdated agents in --json", async () => {
			const { run } = await setup();
			const result = await run(["--json"], {
				agentVersion: versions({
					claude: "2.1.100 (Claude Code)",
					codex: "codex-cli 0.147.3",
				}),
			});
			expect(JSON.parse(result.out).outdated_agents).toEqual([
				{ agent: "claude_code", version: "2.1.100", minimum: "2.1.214" },
				{ agent: "codex", version: "0.147.3", minimum: "0.148.0" },
			]);
		});

		it.each([
			["the minimum version", "2.1.214 (Claude Code)", "codex-cli 0.148.0"],
			["newer versions", "2.2.0 (Claude Code)", "codex-cli 0.200.1"],
			[
				"a pre-release of the minimum version",
				"2.1.214-alpha.1 (Claude Code)",
				"codex-cli 0.148.0-alpha.2",
			],
			["versions it cannot read", undefined, "codex-cli"],
		])("says nothing about %s", async (_, claude, codex) => {
			const { run } = await setup();
			const deps = { agentVersion: versions({ claude, codex }) };
			expect((await run([], deps)).out).not.toContain("older than");
			expect(
				JSON.parse((await run(["--json"], deps)).out).outdated_agents,
			).toEqual([]);
		});

		it("compares the three numbers as numbers and reads the first version in the output", async () => {
			const { run } = await setup();
			const result = await run(["--json"], {
				agentVersion: versions({
					claude: "2.1.99 (Claude Code) 9.9.9",
					codex: "codex-cli 0.99.10",
				}),
			});
			expect(JSON.parse(result.out).outdated_agents).toEqual([
				{ agent: "claude_code", version: "2.1.99", minimum: "2.1.214" },
				{ agent: "codex", version: "0.99.10", minimum: "0.148.0" },
			]);
		});

		it("leaves the agent out when reading its version throws", async () => {
			const { run } = await setup();
			const result = await run(["--json"], {
				agentVersion: async (agent) => {
					if (agent === "claude") throw new Error("spawn failed");
					return "codex-cli 0.147.3";
				},
			});
			expect(result.code).toBe(0);
			expect(JSON.parse(result.out).outdated_agents).toEqual([
				{ agent: "codex", version: "0.147.3", minimum: "0.148.0" },
			]);
		});

		it("does not send the versions it read", async () => {
			const { hf, run } = await setup();
			await run([], {
				agentVersion: versions({ claude: "2.1.100 (Claude Code)" }),
			});
			expect(JSON.stringify(hf.requests)).not.toContain("2.1.100");
		});
	});

	it("only reads: it sends no POST", async () => {
		const { hf, run } = await setup();
		await run();
		expect(
			hf.requests.filter((r) => !r.path.startsWith("GET ")).map((r) => r.path),
		).toEqual([]);
	});

	it("prints the import's login-expired message when the API token cannot be refreshed", async () => {
		const { run } = await setup({
			unauthorizedTokens: ["hf_at_ws1_current"],
			refresh: { status: 400, body: { error: "invalid_grant" } },
		});
		const result = await run();
		expect(result).toMatchObject({ code: 1, out: "", err: EXPIRED });
	});

	it.each([
		["the onboarding request fails", { onboarding: { status: 500 } }],
		[
			"the onboarding response has another shape",
			{ onboarding: { status: 200, body: { workspace_name: "Acme" } } },
		],
		["the repository list fails", { repositories: () => ({ status: 500 }) }],
	])("prints the status failure and exits 1 when %s", async (_, options) => {
		const { run } = await setup(options);
		const result = await run(["--json"]);
		expect(result).toMatchObject({ code: 1, out: "", err: STATUS_FAILED });
	});

	it("prints the status failure when this machine is not connected", async () => {
		const result = await runCli(["status"], {
			homeDir: initializedHome({}).home,
			managedDir: managedDir(null),
			keychain: initializedKeychain("http://127.0.0.1:1").keychain,
		});
		expect(result).toMatchObject({ code: 1, out: "", err: STATUS_FAILED });
	});

	it("rejects unknown options with the usage", async () => {
		const result = await runCli(["status", "--all"]);
		expect(result).toEqual({
			code: 2,
			out: "",
			err: [
				'harnessforce status: unknown option "--all"',
				"Usage: harnessforce status [--json]",
				'Run "harnessforce status --help" for details.',
				"",
			].join("\n"),
		});
	});
});
