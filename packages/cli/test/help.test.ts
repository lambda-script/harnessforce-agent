import { describe, expect, it } from "vitest";
import { runCli } from "./support/cli.js";

const COMMANDS = [
	"login",
	"import",
	"status",
	"otel-headers",
	"run",
	"insights",
	"top",
	"hook",
] as const;

describe("harnessforce --help", () => {
	it.each([[["--help"]], [["-h"]], [["help"]]])(
		"lists every command with a one-line description for %j",
		async (argv) => {
			const r = await runCli(argv);
			expect(r.code).toBe(0);
			expect(r.err).toBe("");
			expect(r.out).toContain("Usage: harnessforce <command> [options]");
			for (const command of COMMANDS)
				expect(r.out).toMatch(new RegExp(`^  ${command} {2,}\\S`, "m"));
			expect(r.out).toContain("harnessforce <command> --help");
		},
	);

	it("lists the commands the agents run apart from the ones you run", async () => {
		const { out } = await runCli(["--help"]);
		const [yours, agents] = out.split("Commands your agents run:\n") as [
			string,
			string,
		];
		for (const command of [
			"login",
			"import",
			"status",
			"run",
			"insights",
			"top",
		])
			expect(yours).toMatch(new RegExp(`^  ${command} {2,}\\S`, "m"));
		for (const command of ["otel-headers", "hook", "insights record"]) {
			expect(yours).not.toMatch(new RegExp(`^  ${command} {2,}\\S`, "m"));
			expect(agents).toMatch(new RegExp(`^  ${command} {2,}\\S`, "m"));
		}
	});

	it("keeps the overview short enough to scan", async () => {
		const r = await runCli(["--help"]);
		expect(r.out.split("\n").length).toBeLessThan(30);
	});
});

describe("harnessforce <command> --help", () => {
	it.each(COMMANDS)(
		"explains %s with the required sections",
		async (command) => {
			const r = await runCli([command, "--help"]);
			expect(r.code).toBe(0);
			expect(r.err).toBe("");
			expect(r.out).toContain(`Usage: harnessforce ${command}`);
			for (const heading of [
				"When to use",
				"What it does",
				"Sends",
				"Does not send",
				"Exit codes",
				"Examples",
			])
				expect(r.out).toContain(`${heading}:`);
		},
	);

	it.each([
		[["help", "insights"], "insights"],
		[["insights", "-h"], "insights"],
		[["insights", "record", "--help"], "insights"],
		[["run", "--issue", "ABC-1", "--help"], "run"],
	])("answers %j with the %s page", async (argv, command) => {
		const r = await runCli(argv);
		expect(r.code).toBe(0);
		expect(r.out).toContain(`Usage: harnessforce ${command}`);
	});

	it("documents the options each command accepts", async () => {
		const out = async (command: string) =>
			(await runCli([command, "--help"])).out;
		expect(await out("login")).not.toContain("--send-content");
		expect(await out("config")).toContain("set send-content on|off");
		expect(await out("login")).toContain("--port");
		expect(await out("top")).toContain("--once");
		expect(await out("top")).toContain("--theme");
		expect(await out("insights")).toContain("--no-send");
		expect(await out("insights")).toContain("clear");
		expect(await out("run")).toContain("--issue");
	});

	it("names the Codex config.toml as the one file that holds the ingest key", async () => {
		const out = (await runCli(["login", "--help"])).out;
		expect(out).toContain("config.toml");
		expect(out).not.toContain("never written to a plain file");
	});

	it("passes --help after the separator to the launched agent", async () => {
		const r = await runCli([
			"run",
			"--issue",
			"ABC-1",
			"--",
			"agent",
			"--help",
		]);
		expect(r.out).not.toContain("Usage: harnessforce run");
	});

	it("does not treat --help as a hook invocation", async () => {
		const r = await runCli(["hook", "--help"]);
		expect(r.code).toBe(0);
		expect(r.out).toContain(
			"Usage: harnessforce hook session-start|post-tool-use|stop",
		);
	});
});

// correlation.md「CLI」: otel-headersの終了コード（3 keyが無い、4 送信先を確かめられない、5 版が対応外、1 それ以外）。
describe("harnessforce otel-headers --help", () => {
	it("lists the exit codes the command uses", async () => {
		const r = await runCli(["otel-headers", "--help"]);
		for (const code of ["0", "3", "4", "5", "1"])
			expect(r.out).toMatch(new RegExp(`^  ${code}  \\S`, "m"));
	});
});

// correlation.md「session import」: Claude Codeの取り込みはcommitを送らず、Codexだけが送る。
describe("harnessforce import --help", () => {
	it("says only Codex sessions send the commit", async () => {
		const r = await runCli(["import", "--help"]);
		expect(r.out).not.toMatch(/repository, branch, commit/);
		expect(r.out).toMatch(/Codex sessions also send the commit/);
	});
});

// correlation.md「session import」・onboarding.md「harnessforce status」・read-api.md: 送る対象と照合の対象は、GET /api/v1/repositories が返すProjectに割り当てたrepositoryに限る。
describe.each(["import", "insights", "status"])(
	"harnessforce %s --help",
	(command) => {
		it("names the project assignment as the condition for sending", async () => {
			const r = await runCli([command, "--help"]);
			expect(r.out).not.toMatch(/\bconnected repositories\b|\bnot connected\b/);
			expect(r.out).toMatch(/assigned to a\s+project/);
		});
	},
);

describe("harnessforce with an unknown command", () => {
	it("points to --help on stderr and exits 2", async () => {
		const r = await runCli(["bogus"]);
		expect(r.code).toBe(2);
		expect(r.out).toBe("");
		expect(r.err).toContain("harnessforce --help");
	});

	it("rejects help for a command that does not exist", async () => {
		const r = await runCli(["help", "bogus"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain("harnessforce --help");
	});
});
