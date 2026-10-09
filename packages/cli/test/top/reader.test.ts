import { appendFileSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunGit } from "@harnessforce/agent-core/process/git";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { describe, expect, it } from "vitest";
import { createTopReader } from "../../src/top/reader.js";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const iso = (offsetSec: number) =>
	new Date(NOW + offsetSec * 1000).toISOString();

function rows(sessionId: string, lastOffsetSec: number, cwd = "/work/web") {
	return (
		line({
			type: "user",
			sessionId,
			cwd,
			gitBranch: "feature/ENG-42-日本語",
			timestamp: iso(lastOffsetSec - 30),
			message: { role: "user", content: "SECRET prompt" },
		}) +
		line({
			type: "assistant",
			sessionId,
			cwd,
			timestamp: iso(lastOffsetSec),
			message: {
				id: `m-${sessionId}`,
				model: "claude-a",
				usage: { input_tokens: 10, output_tokens: 2 },
				content: [{ type: "text", text: "SECRET response" }],
			},
		})
	);
}

function setup() {
	const projectsDir = tempDir("hf-top-projects-");
	const project = join(projectsDir, "-work-web");
	mkdirSync(project, { recursive: true });
	const write = (name: string, text: string, mtimeOffsetSec = 0) => {
		const path = join(project, `${name}.jsonl`);
		writeFileSync(path, text);
		const mtime = new Date(NOW + mtimeOffsetSec * 1000);
		utimesSync(path, mtime, mtime);
		return path;
	};
	const calls: string[] = [];
	const git: RunGit = async (cwd, args) => {
		calls.push(`${cwd} ${args.join(" ")}`);
		if (cwd !== "/work/web") return undefined;
		if (args[0] === "rev-parse") return "true";
		if (args[0] === "remote" && args.length === 1) return "origin";
		return "git@github.com:Acme/Web.git";
	};
	const reader = createTopReader({ projectsDir, git });
	return { write, reader, calls, project };
}

// terminal-view.md「本人の表示」「読むもの」。
describe("reading the sessions on this machine", () => {
	it("shows a session whose last event is within 24 hours, not one 24 hours and a second old", async () => {
		const { write, reader } = setup();
		write("in", rows("in", -24 * 3600));
		write("out", rows("out", -24 * 3600 - 1));
		const snapshot = await reader.refresh(NOW);
		expect(snapshot.sessions.map((s) => s.sessionId)).toEqual(["in"]);
	});

	it("resolves the repository like session import and keeps the branch name as written", async () => {
		const { write, reader } = setup();
		write("a", rows("a", -10));
		const [session] = (await reader.refresh(NOW)).sessions;
		expect(session).toMatchObject({
			repository: "github.com/acme/web",
			branch: "feature/ENG-42-日本語",
		});
	});

	it("leaves the repository empty when it cannot be resolved", async () => {
		const { write, reader } = setup();
		write("a", rows("a", -10, "/elsewhere"));
		const [session] = (await reader.refresh(NOW)).sessions;
		expect(session?.repository).toBeUndefined();
	});

	it("builds rows from the lines it can read and counts the lines it skipped", async () => {
		const { write, reader } = setup();
		write("a", `not json\n[1,2]\n${rows("a", -10)}`);
		const snapshot = await reader.refresh(NOW);
		expect(snapshot.sessions).toHaveLength(1);
		expect(snapshot.skippedLines).toBe(2);
	});

	it("reads only the appended part of a file on the next refresh", async () => {
		const { write, reader, project } = setup();
		const path = write("a", rows("a", -10));
		await reader.refresh(NOW);
		appendFileSync(
			path,
			line({
				type: "assistant",
				sessionId: "a",
				timestamp: iso(5),
				message: {
					id: "m2",
					model: "claude-a",
					usage: { input_tokens: 1, output_tokens: 1 },
					content: [],
				},
			}),
		);
		const snapshot = await reader.refresh(NOW + 10_000);
		expect(snapshot.sessions[0]?.tokens).toEqual({
			input: 11,
			output: 3,
			cacheRead: 0,
			cacheWrite: 0,
		});
		expect(project).toBeTruthy();
	});

	it("does not count a half-written last line until it is completed", async () => {
		const { write, reader } = setup();
		const path = write("a", rows("a", -10));
		await reader.refresh(NOW);
		const next = line({
			type: "assistant",
			sessionId: "a",
			timestamp: iso(5),
			message: {
				id: "m2",
				model: "claude-a",
				usage: { input_tokens: 4, output_tokens: 4 },
				content: [],
			},
		});
		appendFileSync(path, next.slice(0, 40));
		const half = await reader.refresh(NOW + 10_000);
		expect(half.sessions[0]?.tokens?.input).toBe(10);
		expect(half.skippedLines).toBe(0);
		appendFileSync(path, next.slice(40));
		expect(
			(await reader.refresh(NOW + 20_000)).sessions[0]?.tokens?.input,
		).toBe(14);
	});

	it("starts over when a file is replaced by a shorter one", async () => {
		const { write, reader } = setup();
		write("a", rows("a", -10) + rows("a", -5));
		await reader.refresh(NOW);
		write("a", rows("a", -10));
		expect((await reader.refresh(NOW)).sessions[0]?.tokens?.input).toBe(10);
	});

	it("asks git about each directory once", async () => {
		const { write, reader, calls } = setup();
		write("a", rows("a", -10));
		write("b", rows("b", -20));
		await reader.refresh(NOW);
		const first = calls.length;
		await reader.refresh(NOW + 2000);
		expect(calls).toHaveLength(first);
	});

	it("sorts by the last event, newest first", async () => {
		const { write, reader } = setup();
		write("old", rows("old", -300));
		write("new", rows("new", -10));
		expect(
			(await reader.refresh(NOW)).sessions.map((s) => s.sessionId),
		).toEqual(["new", "old"]);
	});

	it("reports nothing when there is no projects directory", async () => {
		const reader = createTopReader({
			projectsDir: "/nonexistent/hf-top-projects",
			git: async () => undefined,
		});
		expect(await reader.refresh(NOW)).toEqual({
			sessions: [],
			skippedLines: 0,
			skippedFiles: 0,
		});
	});

	it("reads a transcript larger than one chunk without losing or doubling a line", async () => {
		const { write, reader } = setup();
		// 日本語を含む行を、1 MiBの境界をまたいで並べる。
		const rowsText = Array.from({ length: 12_000 }, (_, i) =>
			line({
				type: "assistant",
				sessionId: "big",
				cwd: "/work/web",
				timestamp: iso(-100 + (i % 50) / 100),
				message: {
					id: `m-${i}`,
					model: "claude-a",
					usage: { input_tokens: 1, output_tokens: 1 },
					content: [{ type: "text", text: "日本語の本文".repeat(20) }],
				},
			}),
		).join("");
		expect(rowsText.length).toBeGreaterThan(1_000_000);
		write("big", rowsText);
		const snapshot = await reader.refresh(NOW);
		expect(snapshot.sessions[0]?.tokens).toEqual({
			input: 12_000,
			output: 12_000,
			cacheRead: 0,
			cacheWrite: 0,
		});
		expect(snapshot.skippedLines).toBe(0);
	});
});
