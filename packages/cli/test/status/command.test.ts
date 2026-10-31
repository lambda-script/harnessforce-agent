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
	it("prints the workspace, each step and whether this repository is connected", async () => {
		const { run } = await setup();
		const result = await run();
		expect(result.code).toBe(0);
		expect(result.out).toBe(
			[
				"Acme (owner)",
				"✓ Connect the GitHub App",
				"・ Assign repositories to a project https://app.example.test/en/w/acme/step-3",
				"? Set up telemetry",
				"・ Wait for your first run https://app.example.test/en/w/acme/step-5",
				"This repository (github.com/acme/web) is connected to the GitHub App",
				"",
			].join("\n"),
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
				"・ Wait for your first run https://app.example.test/en/w/acme/step-5",
				"This repository (github.com/acme/web) is connected to the GitHub App",
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
			code: 1,
			out: "",
			err: "Usage: harnessforce status [--json]\n",
		});
	});
});
