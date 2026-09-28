import { chmodSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunGit } from "@harnessforce/agent-core/process/git";
import { SessionImportSchema } from "@harnessforce/semconv";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { compileSchema } from "@harnessforce/test-support/validator";
import { describe, expect, it } from "vitest";
import { scanSessions } from "../../src/import/sessions.js";
import { PARSER_VERSION } from "../../src/import/transcript.js";

const NOW = Date.parse("2026-09-27T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
// 公開するschemaで、送る要素を検証する。
const isSessionImport = compileSchema(SessionImportSchema);

const line = (value: unknown) => `${JSON.stringify(value)}\n`;
function transcript(sessionId: string, cwd: string, endedAt: string): string {
	return (
		line({
			type: "user",
			sessionId,
			cwd,
			gitBranch: "main",
			promptId: `p-${sessionId}`,
			timestamp: "2026-09-01T00:00:00Z",
			message: { role: "user", content: "SECRET" },
		}) +
		line({
			type: "assistant",
			sessionId,
			cwd,
			timestamp: endedAt,
			message: {
				id: `m-${sessionId}`,
				model: "claude-a",
				usage: { input_tokens: 3, output_tokens: 4 },
				content: [{ type: "text", text: "SECRET" }],
			},
		})
	);
}

// cwdごとのremote。gitの外のcwdはここに無い。
function fakeGit(remotes: Record<string, string>) {
	const calls: string[] = [];
	const git: RunGit = async (cwd, args) => {
		calls.push(`${cwd} ${args.join(" ")}`);
		const remote = remotes[cwd];
		if (remote === undefined) return undefined;
		if (args[0] === "rev-parse") return "true";
		if (args[0] === "remote" && args.length === 1) return "origin";
		return remote;
	};
	return { git, calls };
}

function projects(
	files: Record<string, { content: string; mtimeMs?: number }>,
) {
	const dir = tempDir("hf-projects-");
	for (const [path, { content, mtimeMs }] of Object.entries(files)) {
		const file = join(dir, path);
		mkdirSync(join(file, ".."), { recursive: true });
		writeFileSync(file, content);
		const time = new Date(mtimeMs ?? NOW);
		utimesSync(file, time, time);
	}
	return dir;
}

const connected = new Set(["github.com/acme/web"]);
const scan = (projectsDir: string, git: RunGit, days = 30) =>
	scanSessions({ projectsDir, sinceMs: NOW - days * DAY, connected, git });

describe("scanSessions", () => {
	it("builds session imports for sessions in connected repositories", async () => {
		const dir = projects({
			"-work-web/s1.jsonl": {
				content: transcript("s1", "/work/web", "2026-09-20T00:00:00Z"),
			},
		});
		const { git } = fakeGit({ "/work/web": "git@github.com:Acme/Web.git" });
		const result = await scan(dir, git);
		expect(result).toEqual({
			skippedLines: 0,
			skippedFiles: 0,
			sessions: [
				{
					agent: "claude_code",
					source: "import",
					session_id: "s1",
					first_prompt_id: "p-s1",
					repository: "github.com/acme/web",
					branch: "main",
					started_at: "2026-09-01T00:00:00.000Z",
					ended_at: "2026-09-20T00:00:00.000Z",
					model: "claude-a",
					input_tokens: 3,
					output_tokens: 4,
					tool_calls: [],
					parser_version: PARSER_VERSION,
				},
			],
		});
	});

	it("produces elements that satisfy the published session import schema", async () => {
		const dir = projects({
			"-work-web/s1.jsonl": {
				content: transcript("s1", "/work/web", "2026-09-20T00:00:00Z"),
			},
		});
		const { git } = fakeGit({ "/work/web": "https://github.com/acme/web" });
		const [session] = (await scan(dir, git)).sessions;
		expect(isSessionImport(session)).toBe(true);
	});

	it("keeps only sessions that ended within session_import_days", async () => {
		const dir = projects({
			"-work-web/in.jsonl": {
				content: transcript("in", "/work/web", "2026-09-13T00:00:00Z"),
			},
			"-work-web/out.jsonl": {
				content: transcript("out", "/work/web", "2026-09-12T23:59:59Z"),
			},
			// 最後に書かれた時刻が範囲より前のfileは開かない。
			"-work-web/old.jsonl": {
				content: "not json\n",
				mtimeMs: NOW - 15 * DAY,
			},
		});
		const { git } = fakeGit({ "/work/web": "https://github.com/acme/web" });
		const result = await scan(dir, git, 14);
		expect(result.sessions.map((s) => s.session_id)).toEqual(["in"]);
		expect(result.skippedLines).toBe(0);
	});

	it("drops sessions outside git, in other repositories, or with a relative cwd", async () => {
		const dir = projects({
			"-a/other.jsonl": {
				content: transcript("other", "/work/other", "2026-09-20T00:00:00Z"),
			},
			"-b/plain.jsonl": {
				content: transcript("plain", "/work/plain", "2026-09-20T00:00:00Z"),
			},
			"-c/relative.jsonl": {
				content: transcript("relative", "work", "2026-09-20T00:00:00Z"),
			},
		});
		const { git, calls } = fakeGit({
			"/work/other": "https://github.com/acme/other",
		});
		expect((await scan(dir, git)).sessions).toEqual([]);
		expect(calls.some((call) => call.startsWith("work "))).toBe(false);
	});

	it("counts skipped lines and ignores other files", async () => {
		const dir = projects({
			"-work-web/s1.jsonl": {
				content: `{broken\n${transcript("s1", "/work/web", "2026-09-20T00:00:00Z")}[]\n`,
			},
			// 行を読めてもmodelの応答が無いfileは、読み飛ばしたfileに数えない。
			"-work-web/empty.jsonl": { content: "{broken\n" },
			"-work-web/notes.txt": { content: "x" },
			"-work-web/s1/subagents/agent-1.jsonl": {
				content: transcript("sub", "/work/web", "2026-09-20T00:00:00Z"),
			},
			"top-level.jsonl": {
				content: transcript("top", "/work/web", "2026-09-20T00:00:00Z"),
			},
		});
		const { git } = fakeGit({ "/work/web": "https://github.com/acme/web" });
		const result = await scan(dir, git);
		expect(result.sessions.map((s) => s.session_id)).toEqual(["s1"]);
		expect(result).toMatchObject({ skippedLines: 3, skippedFiles: 0 });
	});

	// Windowsではchmod 0o000がreadを拒否せず、開けないfileを作れない。
	it.skipIf(process.platform === "win32")(
		"counts unreadable files as skipped",
		async () => {
			const dir = projects({
				"-work-web/s1.jsonl": {
					content: transcript("s1", "/work/web", "2026-09-20T00:00:00Z"),
				},
				"-work-web/locked.jsonl": { content: "{}\n" },
			});
			chmodSync(join(dir, "-work-web/locked.jsonl"), 0o000);
			const { git } = fakeGit({ "/work/web": "https://github.com/acme/web" });
			const result = await scan(dir, git);
			expect(result.sessions.map((s) => s.session_id)).toEqual(["s1"]);
			expect(result).toMatchObject({ skippedLines: 0, skippedFiles: 1 });
		},
	);

	it("resolves each cwd once and orders sessions by start", async () => {
		const later = transcript("b", "/work/web", "2026-09-21T00:00:00Z").replace(
			"2026-09-01T00:00:00Z",
			"2026-09-02T00:00:00Z",
		);
		const dir = projects({
			"-work-web/b.jsonl": { content: later },
			"-work-web/a.jsonl": {
				content: transcript("a", "/work/web", "2026-09-20T00:00:00Z"),
			},
		});
		const { git, calls } = fakeGit({
			"/work/web": "https://github.com/acme/web",
		});
		const result = await scan(dir, git);
		expect(result.sessions.map((s) => s.session_id)).toEqual(["a", "b"]);
		expect(calls.filter((call) => call.includes("rev-parse"))).toHaveLength(1);
	});

	it("reads nothing when the projects directory does not exist", async () =>
		expect(await scan("/nonexistent/hf-projects", fakeGit({}).git)).toEqual({
			sessions: [],
			skippedLines: 0,
			skippedFiles: 0,
		}));
});
