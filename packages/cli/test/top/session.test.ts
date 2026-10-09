import { describe, expect, it } from "vitest";
import {
	ACTIVE_WINDOW_MS,
	SessionAccumulator,
	sessionState,
} from "../../src/top/session.js";

const at = (iso: string) => iso;
const user = (timestamp: string, content: unknown = "SECRET prompt") => ({
	type: "user",
	sessionId: "s-1",
	cwd: "/work/web",
	gitBranch: "main",
	timestamp,
	message: { role: "user", content },
});
const assistant = (
	timestamp: string,
	id: string,
	usage: Record<string, number> | undefined,
	content: unknown[] = [{ type: "text", text: "SECRET response" }],
	model = "claude-a",
) => ({
	type: "assistant",
	sessionId: "s-1",
	cwd: "/work/web",
	timestamp,
	message: { id, model, ...(usage ? { usage } : {}), content },
});

function accumulate(...rows: unknown[]) {
	const acc = new SessionAccumulator();
	for (const row of rows) acc.add(row as Record<string, unknown>);
	return acc.result();
}

// terminal-view.md「本人の表示」「行」: 記録から計算した値だけを持ち、本文を持たない。
describe("accumulating a session", () => {
	it("sums the usage of each response once and keeps the context of the latest response", () => {
		const session = accumulate(
			user(at("2026-10-09T00:00:00Z")),
			// 同じmessage.idの行（content blockごとに分かれる）は1つの応答として数える。
			assistant(at("2026-10-09T00:00:10Z"), "m1", {
				input_tokens: 10,
				output_tokens: 5,
				cache_read_input_tokens: 100,
				cache_creation_input_tokens: 20,
			}),
			assistant(at("2026-10-09T00:00:10Z"), "m1", {
				input_tokens: 10,
				output_tokens: 5,
				cache_read_input_tokens: 100,
				cache_creation_input_tokens: 20,
			}),
			assistant(at("2026-10-09T00:00:20Z"), "m2", {
				input_tokens: 1,
				output_tokens: 7,
				cache_read_input_tokens: 130,
				cache_creation_input_tokens: 0,
			}),
		);
		expect(session?.tokens).toEqual({
			input: 11,
			output: 12,
			cacheRead: 230,
			cacheWrite: 20,
		});
		// 直近の応答のinput + cache read + cache write。
		expect(session?.contextTokens).toBe(131);
		expect(session?.model).toBe("claude-a");
	});

	it("leaves tokens and context empty, not zero, when no response has usage", () => {
		const session = accumulate(
			user(at("2026-10-09T00:00:00Z")),
			assistant(at("2026-10-09T00:00:10Z"), "m1", undefined),
		);
		expect(session?.tokens).toBeUndefined();
		expect(session?.contextTokens).toBeUndefined();
	});

	it("counts tool calls and failures by tool name from the result's is_error", () => {
		const session = accumulate(
			user(at("2026-10-09T00:00:00Z")),
			assistant(
				at("2026-10-09T00:00:10Z"),
				"m1",
				{ input_tokens: 1, output_tokens: 1 },
				[
					{
						type: "tool_use",
						id: "t1",
						name: "Bash",
						input: { command: "SECRET" },
					},
					{ type: "tool_use", id: "t2", name: "Edit", input: {} },
					{ type: "tool_use", id: "t3", name: "Bash", input: {} },
				],
			),
			user(at("2026-10-09T00:00:12Z"), [
				{
					type: "tool_result",
					tool_use_id: "t1",
					is_error: true,
					content: "SECRET error",
				},
				{ type: "tool_result", tool_use_id: "t2", content: "ok" },
				{
					type: "tool_result",
					tool_use_id: "t3",
					is_error: false,
					content: "ok",
				},
			]),
		);
		expect(session?.toolCalls).toBe(3);
		expect(session?.toolFailures).toBe(1);
		expect(session?.tools).toEqual([
			{ tool: "Bash", calls: 2, failures: 1 },
			{ tool: "Edit", calls: 1, failures: 0 },
		]);
	});

	it("takes the repository directory and branch from the first rows, ignoring a detached HEAD", () => {
		const detached = accumulate({
			...user(at("2026-10-09T00:00:00Z")),
			gitBranch: "HEAD",
		});
		expect(detached?.branch).toBeUndefined();
		const session = accumulate(user(at("2026-10-09T00:00:00Z")));
		expect(session).toMatchObject({
			cwd: "/work/web",
			branch: "main",
			sessionId: "s-1",
		});
	});

	it("buckets tokens per hour for the detail view", () => {
		const session = accumulate(
			user(at("2026-10-09T00:10:00Z")),
			assistant(at("2026-10-09T00:20:00Z"), "m1", {
				input_tokens: 3,
				output_tokens: 2,
			}),
			assistant(at("2026-10-09T01:05:00Z"), "m2", {
				input_tokens: 4,
				output_tokens: 1,
			}),
		);
		expect(session?.hourlyTokens).toEqual([
			{ hourStartMs: Date.parse("2026-10-09T00:00:00Z"), tokens: 5 },
			{ hourStartMs: Date.parse("2026-10-09T01:00:00Z"), tokens: 5 },
		]);
	});

	it("returns nothing without a session id or a timestamp", () => {
		expect(
			accumulate({ type: "user", message: { content: "x" } }),
		).toBeUndefined();
	});

	it("keeps no prompt, response, tool input or output text", () => {
		const session = accumulate(
			user(at("2026-10-09T00:00:00Z")),
			assistant(
				at("2026-10-09T00:00:10Z"),
				"m1",
				{ input_tokens: 1, output_tokens: 1 },
				[
					{ type: "text", text: "SECRET response" },
					{
						type: "tool_use",
						id: "t1",
						name: "Bash",
						input: { command: "SECRET cmd", file_path: "/SECRET/path" },
					},
				],
			),
			user(at("2026-10-09T00:00:12Z"), [
				{
					type: "tool_result",
					tool_use_id: "t1",
					is_error: true,
					content: "SECRET error body",
				},
			]),
		);
		expect(JSON.stringify(session)).not.toContain("SECRET");
	});
});

describe("session state", () => {
	const now = Date.parse("2026-10-09T12:00:00Z");
	it("is active when the last event is within 60 seconds and idle after", () => {
		expect(ACTIVE_WINDOW_MS).toBe(60_000);
		expect(sessionState(now - 59_000, now)).toBe("active");
		expect(sessionState(now - 60_000, now)).toBe("active");
		expect(sessionState(now - 61_000, now)).toBe("idle");
	});
});
