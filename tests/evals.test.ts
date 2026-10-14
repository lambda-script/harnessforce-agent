import { spawn } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	type EvalAssertion,
	evaluateAssertions,
	parseCalls,
	validateEvalFile,
} from "../scripts/evals.mjs";

const root = new URL("../", import.meta.url);
const readJson = (p: string) =>
	JSON.parse(readFileSync(new URL(p, root), "utf8"));
const skills = readdirSync(new URL("plugins/harnessforce/skills", root));

describe("eval files", () => {
	it.each(skills)(
		"%s has an eval file with at least 3 valid scenarios",
		(skill) => {
			const path = `evals/${skill}.json`;
			expect(existsSync(new URL(path, root)), `${path} is missing`).toBe(true);
			const file = readJson(path);
			expect(file.skill).toBe(skill);
			expect(file.scenarios.length).toBeGreaterThanOrEqual(3);
			expect(validateEvalFile(file)).toEqual([]);
		},
	);

	it("covers the three record-run examples of the plan", () => {
		const text = JSON.stringify(readJson("evals/record-run.json"));
		expect(text).toContain("no-session-id");
		expect(text).toContain("user-decision");
		expect(text).toContain("no-user-text");
	});

	// evalはmaintainerのためのもので、利用者へ配るpluginに含めない。
	it("keeps evals outside the plugin directory", () =>
		expect(existsSync(new URL("plugins/harnessforce/evals", root))).toBe(
			false,
		));
});

describe("validateEvalFile", () => {
	const scenario = {
		id: "a",
		prompt: "p",
		context: "",
		assertions: [{ type: "called", tool: "start_run" }],
	};

	it("rejects duplicate scenario ids", () =>
		expect(
			validateEvalFile({ skill: "x", scenarios: [scenario, scenario] }),
		).toEqual([expect.stringContaining("duplicate scenario id: a")]));

	it("rejects an unknown predicate", () =>
		expect(
			validateEvalFile({
				skill: "x",
				scenarios: [{ ...scenario, assertions: [{ type: "vibes" }] }],
			}),
		).toEqual([expect.stringContaining("unknown assertion type: vibes")]));

	it("rejects an unknown tool name", () =>
		expect(
			validateEvalFile({
				skill: "x",
				scenarios: [
					{ ...scenario, assertions: [{ type: "called", tool: "nope" }] },
				],
			}),
		).toEqual([expect.stringContaining("unknown tool: nope")]));

	it("rejects a scenario without assertions", () =>
		expect(
			validateEvalFile({
				skill: "x",
				scenarios: [{ ...scenario, assertions: [] }],
			}),
		).toEqual([expect.stringContaining("has no assertions")]));
});

describe("evaluateAssertions", () => {
	const calls = [
		{ tool: "start_run", arguments: { session_id: "s-1" } },
		{ tool: "record_action", arguments: { decision: "Use option B" } },
	];
	const run = (assertion: EvalAssertion) =>
		evaluateAssertions([assertion], calls)[0]?.passed;

	it("called honors min", () => {
		expect(run({ type: "called", tool: "start_run" })).toBe(true);
		expect(run({ type: "called", tool: "start_run", min: 2 })).toBe(false);
	});

	it("not_called", () => {
		expect(run({ type: "not_called", tool: "complete_run" })).toBe(true);
		expect(run({ type: "not_called", tool: "start_run" })).toBe(false);
	});

	it("called_before requires both calls in order", () => {
		expect(
			run({
				type: "called_before",
				first: "start_run",
				second: "record_action",
			}),
		).toBe(true);
		expect(
			run({
				type: "called_before",
				first: "record_action",
				second: "start_run",
			}),
		).toBe(false);
		expect(
			run({
				type: "called_before",
				first: "start_run",
				second: "complete_run",
			}),
		).toBe(false);
	});

	it("arg_excludes fails when any call contains the text", () => {
		expect(
			run({
				type: "arg_excludes",
				tool: "record_action",
				field: "decision",
				text: "secret",
			}),
		).toBe(true);
		expect(
			run({
				type: "arg_excludes",
				tool: "record_action",
				field: "decision",
				text: "option B",
			}),
		).toBe(false);
	});

	it("arg_equals needs a call with the value", () => {
		expect(
			run({
				type: "arg_equals",
				tool: "start_run",
				field: "session_id",
				value: "s-1",
			}),
		).toBe(true);
		expect(
			run({
				type: "arg_equals",
				tool: "start_run",
				field: "session_id",
				value: "s-2",
			}),
		).toBe(false);
	});
});

describe("stub MCP server", () => {
	it("answers the MCP handshake, serves the five tools and logs each call", async () => {
		const dir = mkdtempSync(join(tmpdir(), "hf-eval-"));
		onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
		const log = join(dir, "calls.jsonl");
		const child = spawn(
			process.execPath,
			[new URL("../scripts/stub-mcp.mjs", import.meta.url).pathname],
			{ env: { ...process.env, HF_EVAL_CALL_LOG: log } },
		);
		const lines: string[] = [];
		child.stdout.on("data", (d) =>
			lines.push(...String(d).split("\n").filter(Boolean)),
		);
		const send = (m: object) => child.stdin.write(`${JSON.stringify(m)}\n`);
		send({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "t", version: "0" },
			},
		});
		send({ jsonrpc: "2.0", method: "notifications/initialized" });
		send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
		send({
			jsonrpc: "2.0",
			id: 3,
			method: "tools/call",
			params: { name: "start_run", arguments: { session_id: "s-1" } },
		});
		await new Promise<void>((resolve) => {
			const t = setInterval(() => {
				if (lines.length >= 3) {
					clearInterval(t);
					resolve();
				}
			}, 20);
		});
		child.kill();
		const byId = (id: number) =>
			JSON.parse(lines.find((l) => JSON.parse(l).id === id) ?? "null");
		expect(
			byId(2)
				.result.tools.map((t: { name: string }) => t.name)
				.sort(),
		).toEqual([
			"complete_run",
			"get_issue",
			"record_action",
			"record_plan",
			"start_run",
		]);
		expect(
			readFileSync(log, "utf8")
				.trim()
				.split("\n")
				.map((l) => JSON.parse(l)),
		).toEqual([{ tool: "start_run", arguments: { session_id: "s-1" } }]);
	});
});

describe("parseCalls", () => {
	it("reads the stub's call log and drops the MCP server prefix", () =>
		expect(
			parseCalls(
				'{"tool":"mcp__harnessforce__start_run","arguments":{"a":1}}\n{"tool":"get_issue"}\n',
			),
		).toEqual([
			{ tool: "start_run", arguments: { a: 1 } },
			{ tool: "get_issue" },
		]));

	it("treats a missing log as no calls", () =>
		expect(parseCalls("")).toEqual([]));
});
