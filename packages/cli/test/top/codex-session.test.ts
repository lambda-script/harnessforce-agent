import { describe, expect, it } from "vitest";
import { CodexSessionAccumulator } from "../../src/top/codex-session.js";

const T0 = "2026-10-09T11:00:00.000Z";
const meta = (extra: Record<string, unknown> = {}) => ({
	timestamp: T0,
	type: "session_meta",
	payload: {
		id: "019aaaaa-bbbb",
		cwd: "/work/web",
		git: { branch: "feature/ENG-42", repository_url: "SECRET-url" },
		...extra,
	},
});
const usage = (
	input: number,
	cached: number,
	write: number | undefined,
	out: number,
) => ({
	input_tokens: input,
	cached_input_tokens: cached,
	...(write === undefined ? {} : { cache_write_input_tokens: write }),
	output_tokens: out,
	total_tokens: input + out,
});
const tokenCount = (timestamp: string, total: unknown, last: unknown) => ({
	timestamp,
	type: "event_msg",
	payload: {
		type: "token_count",
		info: {
			total_token_usage: total,
			last_token_usage: last,
			model_context_window: 999,
		},
		rate_limits: {},
	},
});
const call = (type: string, name?: string) => ({
	timestamp: T0,
	type: "response_item",
	payload: {
		type,
		...(name ? { name } : {}),
		arguments: "SECRET args",
		call_id: "c",
	},
});

function build(rows: unknown[]) {
	const acc = new CodexSessionAccumulator();
	for (const r of rows) acc.add(r as Record<string, unknown>);
	return acc.result();
}

describe("Codex rollout session", () => {
	it("takes the id, cwd and branch from session_meta", () => {
		const s = build([meta()]);
		expect(s).toMatchObject({
			agent: "codex",
			sessionId: "019aaaaa-bbbb",
			cwd: "/work/web",
			branch: "feature/ENG-42",
		});
	});

	it("leaves the branch blank for a detached HEAD", () => {
		expect(build([meta({ git: { branch: "HEAD" } })])?.branch).toBeUndefined();
	});

	it("has no session without a session_meta id", () => {
		expect(
			build([{ timestamp: T0, type: "turn_context", payload: { model: "m" } }]),
		).toBeUndefined();
	});

	it("uses the minimum and maximum timestamp of every line", () => {
		const s = build([
			meta(),
			{
				timestamp: "2026-10-09T11:30:00Z",
				type: "unknown_future",
				payload: {},
			},
			{
				timestamp: "2026-10-09T10:55:00Z",
				type: "turn_context",
				payload: { model: "m" },
			},
		]);
		expect(s?.startedAtMs).toBe(Date.parse("2026-10-09T10:55:00Z"));
		expect(s?.lastEventAtMs).toBe(Date.parse("2026-10-09T11:30:00Z"));
	});

	it("takes the tokens from the last total_token_usage and the context from last_token_usage", () => {
		const s = build([
			meta(),
			tokenCount(
				"2026-10-09T11:01:00Z",
				usage(500, 100, 0, 50),
				usage(500, 100, 0, 50),
			),
			tokenCount(
				"2026-10-09T11:02:00Z",
				usage(1000, 700, 50, 200),
				usage(900, 600, 50, 80),
			),
		]);
		expect(s?.tokens).toEqual({
			input: 300,
			output: 200,
			cacheRead: 700,
			cacheWrite: 50,
		});
		expect(s?.contextTokens).toBe(950);
	});

	it("shows the input as 0 when cached tokens exceed the input", () => {
		const s = build([
			meta(),
			tokenCount(
				T0,
				usage(100, 400, undefined, 5),
				usage(100, 400, undefined, 5),
			),
		]);
		expect(s?.tokens?.input).toBe(0);
		expect(s?.tokens?.cacheWrite).toBe(0);
		expect(s?.contextTokens).toBe(100);
	});

	it("leaves tokens and context blank when token_count has no info", () => {
		const s = build([
			meta(),
			{
				timestamp: T0,
				type: "event_msg",
				payload: { type: "token_count", info: null, rate_limits: {} },
			},
		]);
		expect(s?.tokens).toBeUndefined();
		expect(s?.contextTokens).toBeUndefined();
	});

	it("counts function_call, custom_tool_call and local_shell_call by tool name, not search calls", () => {
		const s = build([
			meta(),
			call("function_call", "shell_command"),
			call("function_call", "shell_command"),
			call("custom_tool_call", "apply_patch"),
			call("local_shell_call"),
			call("tool_search_call", "x"),
			call("web_search_call", "y"),
			call("function_call_output"),
		]);
		expect(s?.toolCalls).toBe(4);
		expect(s?.tools).toEqual([
			{ tool: "apply_patch", calls: 1, failures: undefined },
			{ tool: "shell", calls: 1, failures: undefined },
			{ tool: "shell_command", calls: 2, failures: undefined },
		]);
	});

	it("leaves the tool failures blank even when exec_command_end lines exist", () => {
		const s = build([
			meta(),
			call("function_call", "shell_command"),
			{
				timestamp: T0,
				type: "event_msg",
				payload: { type: "exec_command_end", exit_code: 1, status: "failed" },
			},
		]);
		expect(s?.toolFailures).toBeUndefined();
	});

	it("takes the latest turn_context model and counts turns per model", () => {
		const s = build([
			meta(),
			{ timestamp: T0, type: "turn_context", payload: { model: "gpt-a" } },
			{ timestamp: T0, type: "turn_context", payload: { model: "gpt-b" } },
			{ timestamp: T0, type: "turn_context", payload: { model: "gpt-b" } },
		]);
		expect(s?.model).toBe("gpt-b");
		expect(s?.models).toEqual([
			{ model: "gpt-a", responses: 1 },
			{ model: "gpt-b", responses: 2 },
		]);
	});

	it("adds the growth of input plus output to the hour of each token_count", () => {
		const s = build([
			meta(),
			tokenCount(
				"2026-10-09T10:10:00Z",
				usage(1000, 0, 0, 100),
				usage(1000, 0, 0, 100),
			),
			tokenCount(
				"2026-10-09T11:10:00Z",
				usage(1500, 0, 0, 300),
				usage(500, 0, 0, 200),
			),
			// 合計が減った場合は0未満を0にする。
			tokenCount(
				"2026-10-09T11:20:00Z",
				usage(100, 0, 0, 10),
				usage(100, 0, 0, 10),
			),
		]);
		expect(s?.hourlyTokens).toEqual([
			{ hourStartMs: Date.parse("2026-10-09T10:00:00Z"), tokens: 1100 },
			{ hourStartMs: Date.parse("2026-10-09T11:00:00Z"), tokens: 700 },
		]);
	});

	it("never keeps a body", () => {
		const s = build([
			meta(),
			{
				timestamp: T0,
				type: "event_msg",
				payload: { type: "user_message", message: "SECRET prompt" },
			},
			{
				timestamp: T0,
				type: "event_msg",
				payload: { type: "agent_message", message: "SECRET reply" },
			},
			call("function_call", "shell_command"),
		]);
		expect(JSON.stringify(s)).not.toContain("SECRET");
	});
});
