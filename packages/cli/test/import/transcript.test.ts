import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { describe, expect, it } from "vitest";
import {
	PARSER_VERSION,
	parseTranscript,
	parseTranscriptEvents,
} from "../../src/import/transcript.js";

const FIXTURE = join(import.meta.dirname, "fixtures", "session.jsonl");
const SESSION = "4b1c2d3e-0000-4000-8000-000000000001";

const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const response = (
	id: string,
	model: string,
	timestamp: string,
	usage = { input_tokens: 1, output_tokens: 1 },
) =>
	line({
		type: "assistant",
		sessionId: SESSION,
		cwd: "/work/acme-web",
		timestamp,
		message: { id, model, content: [{ type: "text", text: "x" }], usage },
	});

function transcript(content: string): string {
	const file = join(tempDir("hf-transcript-"), `${SESSION}.jsonl`);
	writeFileSync(file, content);
	return file;
}

describe("parseTranscript", () => {
	it("extracts only the allowed metadata from a Claude Code transcript", async () => {
		expect(await parseTranscript(FIXTURE)).toEqual({
			kind: "session",
			skippedLines: 2,
			session: {
				sessionId: SESSION,
				firstPromptId: "prompt-1",
				cwd: "/work/acme-web",
				branch: "eng-42-login",
				startedAt: "2026-09-20T01:00:00.000Z",
				endedAt: "2026-09-20T01:12:00.000Z",
				model: "claude-opus-5-5",
				// 1つの応答が複数の行に分かれても、usageは1回だけ数える。cacheのtokenは含めない。
				inputTokens: 136,
				outputTokens: 31,
				toolCalls: [
					{ tool: "Bash", calls: 2, failures: 1 },
					{ tool: "mcp__harnessforce__start_run", calls: 1, failures: 0 },
				],
			},
		});
	});

	it("never carries prompt, response or tool bodies", async () => {
		expect(readFileSync(FIXTURE, "utf8")).toContain("SECRET-");
		expect(JSON.stringify(await parseTranscript(FIXTURE))).not.toContain(
			"SECRET",
		);
	});

	it("uses the model of the last response when counts tie", async () => {
		const result = await parseTranscript(
			transcript(
				response("m1", "claude-a", "2026-09-20T01:00:00Z") +
					response("m2", "claude-b", "2026-09-20T01:00:01Z") +
					response("m3", "claude-b", "2026-09-20T01:00:02Z") +
					response("m4", "claude-a", "2026-09-20T01:00:03Z"),
			),
		);
		expect(result.kind === "session" && result.session.model).toBe("claude-a");
	});

	it("normalizes timestamps with an offset to UTC and ignores ones without", async () => {
		const result = await parseTranscript(
			transcript(
				response("m1", "claude-a", "2026-09-20T10:00:00+09:00") +
					response("m2", "claude-a", "2026-09-20T09:00:00") +
					response("m3", "claude-a", "2026-09-20T02:00:00.5Z"),
			),
		);
		expect(result.kind === "session" && result.session).toMatchObject({
			startedAt: "2026-09-20T01:00:00.000Z",
			endedAt: "2026-09-20T02:00:00.500Z",
		});
	});

	it("omits a detached HEAD branch and invalid prompt ids", async () => {
		const result = await parseTranscript(
			transcript(
				line({
					type: "user",
					sessionId: SESSION,
					cwd: "/work/acme-web",
					gitBranch: "HEAD",
					promptId: "has space",
					timestamp: "2026-09-20T01:00:00Z",
					message: { role: "user", content: "x" },
				}) + response("m1", "claude-a", "2026-09-20T01:00:01Z"),
			),
		);
		expect(result.kind === "session" && result.session).not.toHaveProperty(
			"branch",
		);
		expect(result.kind === "session" && result.session).not.toHaveProperty(
			"firstPromptId",
		);
	});

	it("drops tool names that the schema would reject", async () => {
		const result = await parseTranscript(
			transcript(
				line({
					type: "assistant",
					sessionId: SESSION,
					timestamp: "2026-09-20T01:00:00Z",
					message: {
						id: "m1",
						model: "claude-a",
						usage: { input_tokens: 1, output_tokens: 1 },
						content: [
							{ type: "tool_use", id: "t1", name: "has space" },
							{ type: "tool_use", id: "t2", name: "x".repeat(129) },
							{ type: "tool_use", id: "t3", name: "Read" },
						],
					},
				}),
			),
		);
		expect(result.kind === "session" && result.session.toolCalls).toEqual([
			{ tool: "Read", calls: 1, failures: 0 },
		]);
	});

	it("has no session to import in a readable file without any model response", async () => {
		expect(
			await parseTranscript(
				transcript(
					line({
						type: "user",
						sessionId: SESSION,
						timestamp: "2026-09-20T01:00:00Z",
						message: { role: "user", content: "x" },
					}),
				),
			),
		).toEqual({ kind: "empty", skippedLines: 0 });
	});

	// correlation.md「session import」: 読めない行はJSONのobjectでない行で、空の行も含む。
	it("counts a blank line as an unreadable line", async () =>
		expect(
			await parseTranscript(
				transcript(
					`${response("m1", "claude-a", "2026-09-20T01:00:00Z")}\n   \n`,
				),
			),
		).toMatchObject({ kind: "session", skippedLines: 2 }));

	// Windowsではchmod 0o000がreadを拒否せず、開けないfileを作れない。
	it.skipIf(process.platform === "win32")(
		"reports a file it cannot open as unreadable",
		async () => {
			const file = transcript(
				response("m1", "claude-a", "2026-09-20T01:00:00Z"),
			);
			chmodSync(file, 0o000);
			expect(await parseTranscript(file)).toEqual({
				kind: "unreadable",
				skippedLines: 0,
			});
		},
	);

	it("has a semantic version", () =>
		expect(PARSER_VERSION).toMatch(/^\d+\.\d+\.\d+$/));
});

// improvement-loop.md「読むもの」: hf tuneはhf importと同じ読み込み処理から、分析に使うeventの列を取り出す。
describe("parseTranscriptEvents", () => {
	const row = (fields: Record<string, unknown>) =>
		line({ sessionId: SESSION, cwd: "/work/acme-web", ...fields });
	const human = (timestamp: string, content: unknown, extra = {}) =>
		row({
			type: "user",
			timestamp,
			message: { role: "user", content },
			...extra,
		});
	const assistant = (timestamp: string, id: string, content: unknown[]) =>
		row({
			type: "assistant",
			timestamp,
			message: {
				id,
				model: "claude-a",
				usage: { input_tokens: 1, output_tokens: 1 },
				content,
			},
		});
	const toolResult = (
		timestamp: string,
		toolUseId: string,
		isError: boolean,
		extra = {},
	) =>
		row({
			type: "user",
			timestamp,
			message: {
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: toolUseId,
						is_error: isError,
						content: [{ type: "text", text: "1 failed" }],
					},
				],
			},
			...extra,
		});

	it("keeps human prompts, responses, tool uses and tool results in order", async () => {
		const result = await parseTranscriptEvents(
			transcript(
				human("2026-09-20T01:00:00Z", "fix the login") +
					assistant("2026-09-20T01:00:01Z", "m1", [
						{
							type: "tool_use",
							id: "t1",
							name: "Bash",
							input: { command: "pnpm test" },
						},
					]) +
					toolResult("2026-09-20T01:00:02Z", "t1", true) +
					assistant("2026-09-20T01:00:03Z", "m2", [
						{ type: "tool_use", id: "t2", name: "Edit", input: {} },
					]) +
					toolResult("2026-09-20T01:00:04Z", "t2", true, {
						toolDenialKind: "user-rejected",
					}) +
					human("2026-09-20T01:00:10Z", [{ type: "text", text: "continue" }]),
			),
		);
		expect(result).toMatchObject({
			kind: "session",
			lines: 6,
			skippedLines: 0,
		});
		expect(result.kind === "session" && result.events).toEqual([
			{
				type: "prompt",
				ms: Date.parse("2026-09-20T01:00:00Z"),
				text: "fix the login",
			},
			{ type: "response", ms: Date.parse("2026-09-20T01:00:01Z") },
			{
				type: "tool_use",
				ms: Date.parse("2026-09-20T01:00:01Z"),
				id: "t1",
				name: "Bash",
				command: "pnpm test",
			},
			{
				type: "tool_result",
				ms: Date.parse("2026-09-20T01:00:02Z"),
				toolUseId: "t1",
				isError: true,
				isDenied: false,
				output: "1 failed",
			},
			{ type: "response", ms: Date.parse("2026-09-20T01:00:03Z") },
			{
				type: "tool_use",
				ms: Date.parse("2026-09-20T01:00:03Z"),
				id: "t2",
				name: "Edit",
			},
			{
				type: "tool_result",
				ms: Date.parse("2026-09-20T01:00:04Z"),
				toolUseId: "t2",
				isError: true,
				isDenied: true,
				output: "1 failed",
			},
			{
				type: "prompt",
				ms: Date.parse("2026-09-20T01:00:10Z"),
				text: "continue",
			},
		]);
	});

	it.each([
		["a meta row", { isMeta: true }, "hello"],
		["a subagent row", { isSidechain: true }, "hello"],
		["a compact summary", { isCompactSummary: true }, "hello"],
		[
			"a prompt that did not come from a human",
			{ origin: { kind: "task-notification" } },
			"hello",
		],
		["a system prompt", { promptSource: "system" }, "hello"],
		["an sdk prompt", { promptSource: "sdk" }, "hello"],
		["command output", {}, "<local-command-stdout>ok</local-command-stdout>"],
		["a task notification", {}, "<task-notification>done</task-notification>"],
		["an interruption", {}, "[Request interrupted by user]"],
		["an empty prompt", {}, "   "],
	])("does not treat %s as a human prompt", async (_, extra, content) => {
		const result = await parseTranscriptEvents(
			transcript(
				human("2026-09-20T01:00:00Z", content, extra) +
					assistant("2026-09-20T01:00:01Z", "m1", []),
			),
		);
		expect(
			result.kind === "session" &&
				result.events.filter((event) => event.type === "prompt"),
		).toEqual([]);
	});

	it("keeps the text of a prompt that also has an image", async () => {
		const result = await parseTranscriptEvents(
			transcript(
				human("2026-09-20T01:00:00Z", [
					{ type: "image", source: {} },
					{ type: "text", text: "look at this" },
				]) + assistant("2026-09-20T01:00:01Z", "m1", []),
			),
		);
		expect(result.kind === "session" && result.events[0]).toMatchObject({
			type: "prompt",
			text: "look at this",
		});
	});

	it("treats a typed prompt from a human origin as a human prompt", async () => {
		const result = await parseTranscriptEvents(
			transcript(
				human("2026-09-20T01:00:00Z", "go", {
					origin: { kind: "human" },
					promptSource: "typed",
				}) + assistant("2026-09-20T01:00:01Z", "m1", []),
			),
		);
		expect(result.kind === "session" && result.events[0]).toEqual({
			type: "prompt",
			ms: Date.parse("2026-09-20T01:00:00Z"),
			text: "go",
		});
	});

	it("reads the same metadata as hf import and counts the lines it read", async () => {
		const events = await parseTranscriptEvents(FIXTURE);
		const imported = await parseTranscript(FIXTURE);
		expect(imported.kind === "session" && events.kind === "session").toBe(true);
		if (imported.kind !== "session" || events.kind !== "session") return;
		expect(events.session).toEqual(imported.session);
		expect(events.skippedLines).toBe(imported.skippedLines);
		expect(events.lines).toBe(19);
	});
});
