import { type AnalysisReport, SCHEMAS } from "@harnessforce/semconv";
import { compileSchema } from "@harnessforce/test-support/validator";
import { describe, expect, it } from "vitest";
import type {
	TranscriptEvent,
	TranscriptSession,
} from "../../src/import/transcript.js";
import {
	ANALYZER_VERSION,
	analyzeSession,
	emptyProposalCounts,
} from "../../src/tune/analyze.js";
import { mcpConfigOf } from "../../src/tune/mcp-config.js";

const T0 = Date.parse("2026-09-20T01:00:00Z");
const at = (seconds: number) => T0 + seconds * 1000;

const SESSION: TranscriptSession = {
	sessionId: "s1",
	firstPromptId: "p1",
	cwd: "/work/web",
	startedAt: "2026-09-20T01:00:00.000Z",
	endedAt: "2026-09-20T02:00:00.000Z",
	model: "claude-a",
	inputTokens: 1,
	outputTokens: 1,
	toolCalls: [],
};

const prompt = (s: number, text: string): TranscriptEvent => ({
	type: "prompt",
	ms: at(s),
	text,
});
const response = (s: number): TranscriptEvent => ({
	type: "response",
	ms: at(s),
});
let nextId = 0;
const bash = (s: number, command: string, isError = false, output = "") => {
	nextId += 1;
	const id = `t${nextId}`;
	return [
		{ type: "tool_use", ms: at(s), id, name: "Bash", command },
		{
			type: "tool_result",
			ms: at(s + 1),
			toolUseId: id,
			isError,
			isDenied: false,
			output,
		},
	] as TranscriptEvent[];
};
const tool = (s: number, name: string, isError = false, isDenied = false) => {
	nextId += 1;
	const id = `t${nextId}`;
	return [
		{ type: "tool_use", ms: at(s), id, name },
		{
			type: "tool_result",
			ms: at(s + 1),
			toolUseId: id,
			isError,
			isDenied,
			output: "",
		},
	] as TranscriptEvent[];
};

const analyze = (events: TranscriptEvent[], mcp = mcpConfigOf([])) =>
	analyzeSession({
		session: SESSION,
		events,
		skippedLines: 2,
		mcp,
		proposals: emptyProposalCounts(),
	});

type Counts = Record<string, Record<string, number | null>>;
const interventionsOf = (report: AnalysisReport) =>
	report.interventions as unknown as Counts;
const loopsOf = (report: AnalysisReport) => report.loops as unknown as Counts;

const isValid = compileSchema(SCHEMAS["analysis-report"]);

describe("analyzeSession", () => {
	it("produces a report that the semconv schema accepts", () => {
		const report = analyze([prompt(0, "fix it"), response(1)]);
		expect(isValid(report)).toBe(true);
		expect(report).toMatchObject({
			agent: "claude_code",
			session_id: "s1",
			first_prompt_id: "p1",
			started_at: "2026-09-20T01:00:00.000Z",
			analyzer_version: ANALYZER_VERSION,
			parser_version: "1.1.0",
			records_skipped: 2,
			mcp_servers: [],
		});
	});

	it("omits first_prompt_id when the transcript has none", () => {
		const { firstPromptId: _, ...withoutPrompt } = SESSION;
		const report = analyzeSession({
			session: withoutPrompt,
			events: [],
			skippedLines: 0,
			mcp: mcpConfigOf([]),
			proposals: emptyProposalCounts(),
		});
		expect(report).not.toHaveProperty("first_prompt_id");
		expect(isValid(report)).toBe(true);
	});

	// improvement-loop.md「受入時に実測する事項」: 記録は権限の確認への許可を残さず、agentの質問への回答を
	// promptから区別できない。この2つは未計測とし、0と区別する。
	it("reports approvals and answers as not measured", () => {
		const report = analyze([prompt(0, "x"), response(1), prompt(5, "y")]);
		for (const kind of ["approval", "answer"] as const)
			expect(report.interventions[kind]).toEqual({
				measurement: "not_measured",
				count: null,
				wait_seconds_median: null,
			});
	});

	it("counts a prompt after a response as an intervention with its wait, but not the first prompt", () => {
		const report = analyze([
			prompt(0, "fix the login"),
			response(1),
			response(10),
			prompt(14, "Continue."),
			response(15),
			prompt(25, "続けて"),
			response(26),
			prompt(27, "also rename the button"),
		]);
		expect(report.interventions.continue).toEqual({
			measurement: "measured",
			count: 2,
			wait_seconds_median: 7,
		});
		expect(report.interventions.other).toEqual({
			measurement: "measured",
			count: 1,
			wait_seconds_median: 1,
		});
		expect(report.interventions.ci_relay).toEqual({
			measurement: "measured",
			count: 0,
			wait_seconds_median: null,
		});
	});

	it("does not count consecutive prompts without a response in between", () => {
		const report = analyze([
			prompt(0, "a"),
			prompt(1, "continue"),
			response(2),
		]);
		expect(interventionsOf(report).continue?.count).toBe(0);
	});

	it("classifies relayed CI failures and review comments", () => {
		const report = analyze([
			prompt(0, "start"),
			response(1),
			prompt(2, "CI failed: Error: Process completed with exit code 1."),
			response(3),
			prompt(4, "The reviewer left comments on the PR: please rename x"),
			response(5),
			prompt(6, "CIが落ちています"),
		]);
		expect(interventionsOf(report).ci_relay?.count).toBe(2);
		expect(interventionsOf(report).review_relay?.count).toBe(1);
	});

	it("counts a test_fix loop from a failing test through an edit to the rerun", () => {
		const report = analyze([
			prompt(0, "start"),
			response(1),
			...bash(10, "pnpm --filter web test", true, "1 failed"),
			...tool(20, "Edit"),
			response(25),
			prompt(30, "continue"),
			...bash(40, "pnpm --filter web test"),
		]);
		expect(loopsOf(report).test_fix).toEqual({
			measurement: "measured",
			occurrences: 1,
			interventions: 1,
			duration_seconds_median: 29,
		});
		expect(loopsOf(report).lint_fix).toEqual({
			measurement: "measured",
			occurrences: 0,
			interventions: 0,
			duration_seconds_median: null,
		});
	});

	it("does not count a rerun without an edit in between", () => {
		const report = analyze([
			...bash(0, "npx vitest run", true),
			...bash(10, "npx vitest run"),
		]);
		expect(loopsOf(report).test_fix?.occurrences).toBe(0);
	});

	it("counts lint_fix, ci_fix, review_response, issue_to_pr and dependency_update", () => {
		const report = analyze([
			...bash(0, "pnpm lint", true),
			...tool(2, "Edit"),
			...bash(4, "pnpm lint"),
			...bash(10, "gh pr checks 12", false, "build  fail  1m"),
			...tool(12, "Write"),
			...bash(14, "git push"),
			...bash(20, "gh pr view 12 --comments"),
			...tool(22, "MultiEdit"),
			...bash(24, "git push origin HEAD"),
			...bash(30, "gh issue view 42"),
			...tool(32, "Edit"),
			...bash(34, "gh pr create --fill"),
			...bash(40, "pnpm up vitest@latest"),
			...bash(42, "pnpm test"),
			...bash(44, "gh pr create --title deps"),
		]);
		expect(loopsOf(report).lint_fix?.occurrences).toBe(1);
		expect(loopsOf(report).ci_fix?.occurrences).toBe(1);
		expect(loopsOf(report).review_response?.occurrences).toBe(1);
		expect(loopsOf(report).issue_to_pr).toMatchObject({
			occurrences: 1,
			duration_seconds_median: 4,
		});
		expect(loopsOf(report).dependency_update?.occurrences).toBe(1);
	});

	it("starts ci_fix from a CI failure that a human relays", () => {
		const report = analyze([
			prompt(0, "start"),
			response(1),
			prompt(2, "the CI is failing on main"),
			...tool(3, "Edit"),
			...bash(5, "git push"),
		]);
		expect(loopsOf(report).ci_fix).toMatchObject({
			occurrences: 1,
			interventions: 1,
		});
	});

	it("counts calls and failures per configured MCP server and gathers the rest as unlisted", () => {
		const mcp = mcpConfigOf([
			"github",
			"linear",
			"harnessforce@harnessforce-agent:harnessforce",
		]);
		const report = analyze(
			[
				...tool(0, "mcp__playwright__browser_click"),
				...tool(2, "mcp__playwright__browser_close", true),
				...tool(4, "mcp__linear__get_issue", true, true),
				...tool(6, "mcp__plugin_harnessforce_harnessforce__start_run", true),
			],
			mcp,
		);
		expect(report.mcp_servers).toEqual([
			{
				server: "github",
				configured: true,
				measurement: "measured",
				calls: 0,
				failures_measurement: "measured",
				failures: 0,
			},
			{
				server: "harnessforce@harnessforce-agent:harnessforce",
				configured: true,
				measurement: "measured",
				calls: 1,
				failures_measurement: "measured",
				failures: 1,
			},
			{
				server: "linear",
				configured: true,
				measurement: "measured",
				calls: 1,
				failures_measurement: "measured",
				failures: 0,
			},
			{
				server: "unlisted",
				configured: false,
				measurement: "measured",
				calls: 2,
				failures_measurement: "measured",
				failures: 1,
			},
		]);
		expect(isValid(report)).toBe(true);
	});

	it("gathers a tool whose server two plugins could own as unlisted", () => {
		const mcp = mcpConfigOf(["a_b@m:c", "a@m:b_c"]);
		const report = analyze([...tool(0, "mcp__plugin_a_b_c__x")], mcp);
		expect(
			report.mcp_servers.find((s) => s.server === "unlisted"),
		).toMatchObject({
			calls: 1,
		});
	});

	it("maps a server name after replacing characters that tool names do not allow", () => {
		const report = analyze(
			[...tool(0, "mcp__my_server__x")],
			mcpConfigOf(["my.server"]),
		);
		expect(report.mcp_servers).toEqual([
			expect.objectContaining({ server: "my.server", calls: 1 }),
		]);
	});

	it("carries the proposal counts it is given", () => {
		const proposals = {
			...emptyProposalCounts(),
			skill: { shown: 2, applied_detected: 1 },
		};
		const report = analyzeSession({
			session: SESSION,
			events: [],
			skippedLines: 0,
			mcp: mcpConfigOf([]),
			proposals,
		});
		expect(report.proposals.skill).toEqual({ shown: 2, applied_detected: 1 });
		expect(report.proposals.hook).toEqual({ shown: 0, applied_detected: 0 });
	});
});
