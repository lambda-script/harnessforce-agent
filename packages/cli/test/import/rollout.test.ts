import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { describe, expect, it } from "vitest";
import {
	CODEX_PARSER_VERSION,
	parseRollout,
} from "../../src/import/rollout.js";

const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const COMMIT = "a".repeat(40);

const meta = (id = "019a-session", extra: object = {}) =>
	line({
		timestamp: "2026-09-01T00:00:00.000Z",
		type: "session_meta",
		payload: {
			id,
			cwd: "/work/repo",
			git: { branch: "main", commit_hash: COMMIT },
			...extra,
		},
	});
const turn = (model: string, at = "2026-09-01T00:00:01.000Z") =>
	line({ timestamp: at, type: "turn_context", payload: { model } });
const tokenCount = (
	total: object,
	at = "2026-09-01T00:00:02.000Z",
	last: object = total,
) =>
	line({
		timestamp: at,
		type: "event_msg",
		payload: {
			type: "token_count",
			info: { total_token_usage: total, last_token_usage: last },
		},
	});
const call = (type: string, name?: string) =>
	line({
		timestamp: "2026-09-01T00:00:03.000Z",
		type: "response_item",
		payload: { type, ...(name ? { name } : {}), arguments: "SECRET" },
	});

function parse(content: string) {
	const dir = tempDir("rollout");
	const path = join(dir, "rollout-1.jsonl");
	writeFileSync(path, content);
	return parseRollout(path);
}

describe("parseRollout", () => {
	it("takes the session, repository inputs, model, tokens and tool counts without any body", async () => {
		const result = await parse(
			meta() +
				turn("gpt-a") +
				turn("gpt-b", "2026-09-01T00:00:01.500Z") +
				turn("gpt-b", "2026-09-01T00:00:01.600Z") +
				call("function_call", "apply_patch") +
				call("custom_tool_call", "apply_patch") +
				call("local_shell_call") +
				call("web_search_call") +
				call("function_call", "bad name") +
				tokenCount({
					input_tokens: 100,
					cached_input_tokens: 30,
					output_tokens: 20,
					reasoning_output_tokens: 5,
					cache_write_input_tokens: 9,
				}) +
				tokenCount(
					{
						input_tokens: 200,
						cached_input_tokens: 50,
						output_tokens: 40,
						reasoning_output_tokens: 8,
					},
					"2026-09-01T00:05:00.000Z",
				),
		);
		expect(result).toEqual({
			kind: "session",
			skippedLines: 0,
			session: {
				sessionId: "019a-session",
				cwd: "/work/repo",
				branch: "main",
				commit: COMMIT,
				startedAt: "2026-09-01T00:00:00.000Z",
				endedAt: "2026-09-01T00:05:00.000Z",
				model: "gpt-b",
				inputTokens: 150,
				outputTokens: 40,
				toolCalls: [
					{ tool: "apply_patch", calls: 2 },
					{ tool: "shell", calls: 1 },
				],
			},
		});
		expect(JSON.stringify(result)).not.toContain("SECRET");
		expect(CODEX_PARSER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
	});

	it("takes the last appearing model when the counts tie and omits a detached branch and a bad commit", async () => {
		const result = await parse(
			meta("s1", { git: { branch: "HEAD", commit_hash: "not-a-sha" } }) +
				turn("gpt-a") +
				turn("gpt-b") +
				tokenCount({
					input_tokens: 1,
					output_tokens: 2,
				}),
		);
		expect(result).toMatchObject({
			kind: "session",
			session: { model: "gpt-b" },
		});
		if (result.kind !== "session") throw new Error("expected a session");
		expect(result.session).not.toHaveProperty("branch");
		expect(result.session).not.toHaveProperty("commit");
	});

	it("counts the lines that are not JSON objects and skips unknown types without counting", async () => {
		const result = await parse(
			meta() +
				"not json\n[1]\n" +
				line({ timestamp: "2026-09-01T00:00:01.000Z", type: "new_kind" }) +
				turn("gpt-a") +
				tokenCount({ input_tokens: 1, output_tokens: 1 }),
		);
		expect(result).toMatchObject({ kind: "session", skippedLines: 2 });
	});

	it("treats a file without a usable session_meta as unreadable", async () => {
		expect(await parse(turn("gpt-a"))).toMatchObject({ kind: "unreadable" });
		expect(await parse(meta("bad id"))).toMatchObject({ kind: "unreadable" });
	});

	it("reports a session that ended before any response as incomplete, silently", async () => {
		expect(await parse(meta())).toMatchObject({ kind: "incomplete" });
	});

	it("reports a session without a model or without total token usage as unextractable", async () => {
		expect(
			await parse(meta() + tokenCount({ input_tokens: 1, output_tokens: 1 })),
		).toMatchObject({
			kind: "unextractable",
			cwd: "/work/repo",
			endedAt: "2026-09-01T00:00:02.000Z",
		});
		expect(await parse(meta() + turn("gpt-a"))).toMatchObject({
			kind: "unextractable",
		});
		expect(
			await parse(
				meta() +
					turn("gpt-a") +
					line({
						timestamp: "2026-09-01T00:00:02.000Z",
						type: "event_msg",
						payload: { type: "token_count", info: null },
					}),
			),
		).toMatchObject({ kind: "unextractable" });
	});

	it("reports a file that cannot be opened as unreadable", async () => {
		expect(await parseRollout("/nonexistent/rollout.jsonl")).toMatchObject({
			kind: "unreadable",
		});
	});
});
