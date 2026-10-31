import { describe, expect, it } from "vitest";
import { runCli } from "./support/cli.js";

const COMMANDS = [
	"init",
	"import",
	"status",
	"otel-headers",
	"run",
	"tune",
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
		[["help", "tune"], "tune"],
		[["tune", "-h"], "tune"],
		[["tune", "record", "--help"], "tune"],
		[["run", "--issue", "ABC-1", "--help"], "run"],
	])("answers %j with the %s page", async (argv, command) => {
		const r = await runCli(argv);
		expect(r.code).toBe(0);
		expect(r.out).toContain(`Usage: harnessforce ${command}`);
	});

	it("documents the options each command accepts", async () => {
		const out = async (command: string) =>
			(await runCli([command, "--help"])).out;
		expect(await out("init")).toContain("--send-content");
		expect(await out("init")).toContain("--port");
		expect(await out("top")).toContain("--once");
		expect(await out("top")).toContain("--theme");
		expect(await out("tune")).toContain("--no-send");
		expect(await out("tune")).toContain("--purge");
		expect(await out("run")).toContain("--issue");
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

describe("harnessforce with an unknown command", () => {
	it("points to --help on stderr and exits 1", async () => {
		const r = await runCli(["bogus"]);
		expect(r.code).toBe(1);
		expect(r.out).toBe("");
		expect(r.err).toContain("Usage: harnessforce <command> [options]");
		expect(r.err).toContain("harnessforce --help");
	});

	it("rejects help for a command that does not exist", async () => {
		const r = await runCli(["help", "bogus"]);
		expect(r.code).toBe(1);
		expect(r.err).toContain("harnessforce --help");
	});
});
