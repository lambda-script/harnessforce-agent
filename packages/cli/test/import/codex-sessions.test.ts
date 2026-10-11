import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunGit } from "@harnessforce/agent-core/process/git";
import { SessionImportSchema } from "@harnessforce/semconv";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { compileSchema } from "@harnessforce/test-support/validator";
import { describe, expect, it } from "vitest";
import { CODEX_PARSER_VERSION } from "../../src/import/rollout.js";
import { scanCodexSessions } from "../../src/import/sessions.js";

const NOW = Date.parse("2026-09-27T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const isSessionImport = compileSchema(SessionImportSchema);
const line = (value: unknown) => `${JSON.stringify(value)}\n`;

function rollout(id: string, cwd: string, endedAt: string, withTokens = true) {
	return (
		line({
			timestamp: "2026-01-01T00:00:00.000Z",
			type: "session_meta",
			payload: { id, cwd, git: { branch: "main" } },
		}) +
		line({
			timestamp: "2026-01-01T00:00:01.000Z",
			type: "turn_context",
			payload: { model: "gpt-a" },
		}) +
		line({
			timestamp: "2026-01-01T00:00:02.000Z",
			type: "response_item",
			payload: { type: "function_call", name: "shell_x", arguments: "SECRET" },
		}) +
		(withTokens
			? line({
					timestamp: endedAt,
					type: "event_msg",
					payload: {
						type: "token_count",
						info: {
							total_token_usage: {
								input_tokens: 10,
								cached_input_tokens: 4,
								output_tokens: 5,
							},
						},
					},
				})
			: line({ timestamp: endedAt, type: "event_msg", payload: { type: "x" } }))
	);
}

function codexHome(files: Record<string, string>) {
	const dir = tempDir("hf-codex-");
	for (const [path, content] of Object.entries(files)) {
		const file = join(dir, "sessions", path);
		mkdirSync(join(file, ".."), { recursive: true });
		writeFileSync(file, content);
	}
	return dir;
}

function fakeGit(remotes: Record<string, string>) {
	const git: RunGit = async (cwd, args) => {
		const remote = remotes[cwd];
		if (remote === undefined) return undefined;
		if (args[0] === "rev-parse") return "true";
		if (args[0] === "remote" && args.length === 1) return "origin";
		return remote;
	};
	return git;
}

const connected = new Set(["github.com/acme/web"]);
const scan = (codexDir: string, git: RunGit, days = 30) =>
	scanCodexSessions({
		codexDir,
		sinceMs: NOW - days * DAY,
		connected,
		git,
	});
const webGit = () => fakeGit({ "/work/web": "git@github.com:Acme/Web.git" });

describe("scanCodexSessions", () => {
	it("builds codex session imports without failures and without any body", async () => {
		const dir = codexHome({
			"2026/09/20/rollout-a.jsonl": rollout(
				"c1",
				"/work/web",
				"2026-09-20T00:00:00.000Z",
			),
		});
		const result = await scan(dir, webGit());
		expect(result).toEqual({
			skippedLines: 0,
			skippedFiles: 0,
			unextractable: 0,
			compressed: 0,
			sessions: [
				{
					agent: "codex",
					source: "import",
					session_id: "c1",
					repository: "github.com/acme/web",
					branch: "main",
					started_at: "2026-01-01T00:00:00.000Z",
					ended_at: "2026-09-20T00:00:00.000Z",
					model: "gpt-a",
					input_tokens: 6,
					output_tokens: 5,
					tool_calls: [{ tool: "shell_x", calls: 1 }],
					parser_version: CODEX_PARSER_VERSION,
				},
			],
		});
		for (const session of result.sessions)
			expect(isSessionImport(session)).toBe(true);
		expect(JSON.stringify(result)).not.toContain("SECRET");
	});

	it("treats a missing sessions directory as no sessions", async () => {
		const result = await scan(tempDir("hf-codex-empty-"), webGit());
		expect(result).toMatchObject({ sessions: [], skippedFiles: 0 });
	});

	it("sends only sessions that ended in the range in connected repositories", async () => {
		const dir = codexHome({
			"2026/09/20/rollout-in.jsonl": rollout(
				"in",
				"/work/web",
				"2026-09-20T00:00:00.000Z",
			),
			"2026/07/01/rollout-old.jsonl": rollout(
				"old",
				"/work/web",
				"2026-07-01T00:00:00.000Z",
			),
			"2026/09/20/rollout-other.jsonl": rollout(
				"other",
				"/work/other",
				"2026-09-20T00:00:00.000Z",
			),
		});
		const result = await scan(
			dir,
			fakeGit({
				"/work/web": "git@github.com:Acme/Web.git",
				"/work/other": "git@github.com:Acme/Other.git",
			}),
		);
		expect(result.sessions.map((s) => s.session_id)).toEqual(["in"]);
	});

	it("counts the sessions whose model or token usage cannot be read, only after the range and repository checks", async () => {
		const dir = codexHome({
			"2026/09/20/rollout-bad.jsonl": rollout(
				"bad",
				"/work/web",
				"2026-09-20T00:00:00.000Z",
				false,
			),
			"2026/09/20/rollout-bad-other.jsonl": rollout(
				"bad2",
				"/work/other",
				"2026-09-20T00:00:00.000Z",
				false,
			),
			"2026/07/01/rollout-bad-old.jsonl": rollout(
				"bad3",
				"/work/web",
				"2026-07-01T00:00:00.000Z",
				false,
			),
		});
		const result = await scan(
			dir,
			fakeGit({
				"/work/web": "git@github.com:Acme/Web.git",
				"/work/other": "git@github.com:Acme/Other.git",
			}),
		);
		expect(result).toMatchObject({ sessions: [], unextractable: 1 });
	});

	it("counts unreadable files and skipped lines, and the compressed rollouts in the range", async () => {
		const dir = codexHome({
			"2026/09/20/rollout-nometa.jsonl": line({
				timestamp: "2026-09-20T00:00:00.000Z",
				type: "turn_context",
				payload: { model: "m" },
			}),
			"2026/09/20/rollout-lines.jsonl": `oops\n${rollout("c2", "/work/web", "2026-09-20T00:00:00.000Z")}`,
			"2026/09/20/rollout-z.jsonl.zst": "binary",
			"2026/09/26/rollout-z2.jsonl.zst": "binary",
			"2026/01/01/rollout-zold.jsonl.zst": "binary",
		});
		const result = await scan(dir, webGit());
		expect(result).toMatchObject({
			skippedFiles: 1,
			skippedLines: 1,
			compressed: 2,
		});
		expect(result.sessions.map((s) => s.session_id)).toEqual(["c2"]);
	});
});
