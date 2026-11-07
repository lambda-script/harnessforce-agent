import { describe, expect, it } from "vitest";
import { runCli } from "./support/cli.js";

// 引数の誤りは、何が違うかの1行と、そのcommandのusageをstderrへ出し、終了コード2で終わる。
describe("harnessforce with bad arguments", () => {
	it.each([
		[["login", "--bogus"], "login", 'unknown option "--bogus"'],
		[
			["login", "--port", "0"],
			"login",
			'"--port" must be an integer from 1 to 65535',
		],
		[["login", "--port"], "login", '"--port" needs a value'],
		[
			["login", "--no-plugin-auto-update", "--no-plugin-auto-update"],
			"login",
			'"--no-plugin-auto-update" was given more than once',
		],
		[["login", "true"], "login", 'unexpected argument "true"'],
		[["import", "--all"], "import", 'unknown option "--all"'],
		[["status", "--all"], "status", 'unknown option "--all"'],
		[
			["status", "--json", "--json"],
			"status",
			'"--json" was given more than once',
		],
		[["run"], "run", 'missing "--issue <identifier>"'],
		[["run", "--issue"], "run", '"--issue" needs an Issue identifier'],
		[
			["run", "--issue", "ENG-1", "claude"],
			"run",
			'missing "--" before the agent command',
		],
		[
			["run", "--issue", "ENG-1", "--"],
			"run",
			'missing the agent command after "--"',
		],
		[["top", "--bogus"], "top", 'unknown option "--bogus"'],
		[
			["top", "--theme", "neon"],
			"top",
			'"--theme" must be one of auto, light, dark, ansi',
		],
		[["top", "--once", "--once"], "top", '"--once" was given more than once'],
	])(
		"answers %j with the reason and the %s usage",
		async (argv, command, reason) => {
			const r = await runCli(argv);
			expect(r.code).toBe(2);
			expect(r.out).toBe("");
			const [first, second] = r.err.split("\n");
			expect(first).toBe(`harnessforce ${command}: ${reason}`);
			expect(second).toMatch(new RegExp(`^Usage: harnessforce ${command}\\b`));
			expect(r.err).toContain(`Run "harnessforce ${command} --help"`);
		},
	);

	it("names an unknown option placed where the -- is expected", async () => {
		const r = await runCli([
			"run",
			"--issue",
			"ENG-1",
			"--bogus",
			"--",
			"claude",
		]);
		expect(r.code).toBe(2);
		expect(r.err.split("\n")[0]).toBe(
			'harnessforce run: unknown option "--bogus"',
		);
	});

	// agentのhookはexit 2を処理を止める合図として扱うため、hookの引数の誤りは1で終える。
	it.each([
		[["hook"], "missing the hook event"],
		[["hook", "session-end"], 'unknown hook event "session-end"'],
		[["hook", "session-start", "x"], 'unexpected argument "x"'],
	])(
		"answers %j with the reason and the hook usage and exit 1",
		async (argv, reason) => {
			const r = await runCli(argv);
			expect(r.code).toBe(1);
			expect(r.err.split("\n").slice(0, 2)).toEqual([
				`harnessforce hook: ${reason}`,
				"Usage: harnessforce hook session-start|post-tool-use|stop",
			]);
		},
	);

	// correlation.md「CLI」: otel-headersの終了コードはClaude Codeとhookとの契約で、3、4、5以外の失敗は1。
	it("keeps exit code 1 for otel-headers, whose exit codes are a contract", async () => {
		const r = await runCli(["otel-headers", "extra"]);
		expect(r.code).toBe(1);
		expect(r.err.split("\n")[0]).toBe(
			'harnessforce otel-headers: unexpected argument "extra"',
		);
		expect(r.err).toContain("Usage: harnessforce otel-headers");
	});
});

describe("harnessforce with an unknown command", () => {
	it.each([
		["stauts", "status"],
		["imprt", "import"],
		["insihgts", "insights"],
		["version", "--version"],
		["--verison", "--version"],
	])("suggests the closest name for %s", async (word, suggestion) => {
		const r = await runCli([word]);
		expect(r.code).toBe(2);
		expect(r.out).toBe("");
		expect(r.err).toContain(`Did you mean "${suggestion}"?`);
		expect(r.err).toContain('Run "harnessforce --help" to list the commands.');
	});

	it("names the unknown word and suggests nothing when no name is close", async () => {
		const r = await runCli(["deploy"]);
		expect(r).toEqual({
			code: 2,
			out: "",
			err: 'harnessforce: unknown command "deploy"\nRun "harnessforce --help" to list the commands.\n',
		});
	});

	it("calls a word that starts with a dash an option", async () => {
		const r = await runCli(["--bogus"]);
		expect(r.code).toBe(2);
		expect(r.err.split("\n")[0]).toBe('harnessforce: unknown option "--bogus"');
	});

	it("answers help for an unknown command the same way", async () => {
		const r = await runCli(["help", "stauts"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain('unknown command "stauts"');
		expect(r.err).toContain('Did you mean "status"?');
	});

	it.each([[["help", "help"]], [["--help", "--help"]]])(
		"answers %j with the overview",
		async (argv) => {
			const r = await runCli(argv);
			expect(r.code).toBe(0);
			expect(r.out).toBe((await runCli(["--help"])).out);
		},
	);

	it("does not suggest a word that is already spelled right", async () => {
		const r = await runCli(["help", "--version"]);
		expect(r.code).toBe(2);
		expect(r.err).toContain('unknown option "--version"');
		expect(r.err).not.toContain("Did you mean");
	});

	it("rejects an argument after the help topic", async () => {
		const r = await runCli(["help", "status", "junk"]);
		expect(r.code).toBe(2);
		expect(r.out).toBe("");
		expect(r.err.split("\n")[0]).toBe(
			'harnessforce: unexpected argument "junk"',
		);
	});

	it("rejects arguments after --version", async () => {
		const r = await runCli(["--version", "x"]);
		expect(r.code).toBe(2);
		expect(r.err.split("\n")[0]).toBe('harnessforce: unexpected argument "x"');
	});
});

describe("harnessforce without a command", () => {
	it("prints the overview help on stdout and exits 0", async () => {
		const r = await runCli([]);
		expect(r.code).toBe(0);
		expect(r.err).toBe("");
		expect(r.out).toBe((await runCli(["--help"])).out);
	});
});
