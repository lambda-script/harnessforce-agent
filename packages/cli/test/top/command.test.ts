import {
	appendFileSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../support/cli.js";
import {
	fakeTty,
	gitWithRemote,
	NOW,
	projects,
	transcript,
} from "./support.js";

function setup(sessions: Record<string, string> = {}) {
	const p = projects();
	for (const [name, text] of Object.entries(sessions)) p.write(name, text);
	const tty = fakeTty({ isTty: false });
	const run = (args: string[], extra: Parameters<typeof runCli>[1] = {}) =>
		runCli(["top", ...args], {
			homeDir: p.home,
			managedDir: "/nonexistent/hf-managed",
			importGit: gitWithRemote,
			now: () => new Date(NOW),
			// ネットワークに接続しない。
			fetch: async () => {
				throw new Error("top must not use the network");
			},
			top: tty.io,
			...extra,
		});
	return { run, tty, p };
}

// terminal-view.md「受入条件」。
describe("harnessforce top --json and --once", () => {
	it("shows the sessions before harnessforce init, with no network and no keychain", async () => {
		const { run } = setup({ a: transcript("a", -10) });
		const result = await run(["--json"]);
		expect(result.code).toBe(0);
		const { sessions } = JSON.parse(result.out);
		expect(sessions).toHaveLength(1);
	});

	it("returns the documented fields, without any body", async () => {
		const { run } = setup({
			a: transcript("sess-aaaa1111", -10, { failures: 1 }),
		});
		const result = await run(["--json"]);
		const [session] = JSON.parse(result.out).sessions;
		expect(session).toEqual({
			session_id: "sess-aaa",
			state: "active",
			repository: "github.com/acme/web",
			branch: "feature/ENG-42",
			model: "claude-opus-5-5",
			started_at: new Date(NOW - 310_000).toISOString(),
			last_event_at: new Date(NOW - 10_000).toISOString(),
			tokens: { input: 1200, output: 300, cache_read: 5000, cache_write: 100 },
			context_tokens: 6300,
			tool_calls: 3,
			tool_failures: 1,
		});
		expect(result.out).not.toContain("SECRET");
	});

	it("keeps unknown values as null, not zero", async () => {
		const { run } = setup({ a: transcript("a", -10, { usage: false }) });
		const [session] = JSON.parse((await run(["--json"])).out).sessions;
		expect(session.tokens).toBeNull();
		expect(session.context_tokens).toBeNull();
	});

	it("calls a session 59 seconds old active and one 61 seconds old idle", async () => {
		const { run } = setup({ a: transcript("a", -59), b: transcript("b", -61) });
		const states = Object.fromEntries(
			JSON.parse((await run(["--json"])).out).sessions.map(
				(s: { session_id: string; state: string }) => [s.session_id, s.state],
			),
		);
		expect(states).toEqual({ a: "active", b: "idle" });
	});

	it("leaves out a session whose last event is 24 hours and a second old", async () => {
		const { run } = setup({
			a: transcript("a", -86_400),
			b: transcript("b", -86_401),
		});
		const ids = JSON.parse((await run(["--json"])).out).sessions.map(
			(s: { session_id: string }) => s.session_id,
		);
		expect(ids).toEqual(["a"]);
	});

	it("prints plain text without escapes for --once and for a non-TTY", async () => {
		const { run } = setup({ a: transcript("a", -10, { failures: 2 }) });
		for (const args of [["--once"], []]) {
			const result = await run(args);
			expect(result.code).toBe(0);
			expect(result.out).not.toContain("\x1b");
			expect(result.out).toContain("● active");
			expect(result.out).toContain("✕ 2/3");
			expect(result.out).not.toContain("SECRET");
			expect(result.out).not.toContain("%");
		}
	});

	it("uses ASCII with --ascii and a 80-column width off a TTY", async () => {
		const { run } = setup({
			a: transcript("a", -10, { failures: 2, branch: "feature/日本語" }),
		});
		const out = (await run(["--once", "--ascii"])).out;
		expect(out).toContain("* active");
		expect(out).toContain("x 2/3");
		for (const l of out.split("\n"))
			expect([...l].length).toBeLessThanOrEqual(80);
	});

	it("never asks the terminal for its background and never writes to it", async () => {
		const { run, tty } = setup({ a: transcript("a", -10) });
		await run(["--once", "--theme", "auto"]);
		await run(["--json"]);
		await run([]);
		expect(tty.writes).toEqual([]);
	});

	it("reports the lines it could not read", async () => {
		const { run } = setup({ a: `broken\n${transcript("a", -10)}` });
		expect((await run(["--once"])).out).toContain("読めなかった1行");
	});

	it("says there are no sessions in the last 24 hours", async () => {
		const { run } = setup();
		expect((await run(["--once"])).out).toContain("直近24時間");
	});

	it("rejects arguments it does not know", async () => {
		const { run } = setup();
		for (const args of [
			["--bogus"],
			["--theme"],
			["--theme", "neon"],
			["--once", "--once"],
			["extra"],
		]) {
			const result = await run(args);
			expect(result.code).toBe(1);
			expect(result.err).toContain("harnessforce top");
		}
	});
});

describe("harnessforce top settings", () => {
	function config(home: string, text: string) {
		const dir = join(home, ".harnessforce");
		mkdirSync(dir, { recursive: true });
		const path = join(dir, "config.json");
		writeFileSync(path, text);
		return path;
	}
	const NOTICE =
		"端末の設定（~/.harnessforce/config.json）を読めないため、既定の表示にします";

	it.each([
		["broken JSON", "{"],
		["not an object", "[]"],
		["top is not an object", '{"top": 1}'],
		["ambiguous_width 3", '{"top": {"ambiguous_width": 3}}'],
		["braille is not a boolean", '{"top": {"braille": "yes"}}'],
	])("starts with the defaults and says so for %s, without touching the file", async (_name, text) => {
		const { run, p } = setup({ a: transcript("a", -10) });
		const path = config(p.home, text);
		const result = await run(["--once"]);
		expect(result.code).toBe(0);
		expect(result.out).toContain(NOTICE);
		expect(readFileSync(path, "utf8")).toBe(text);
	});

	it("does not complain when the file is missing, when tune keys are present, or when the values are valid", async () => {
		const { run, p } = setup({ a: transcript("a", -10) });
		expect((await run(["--once"])).out).not.toContain(NOTICE);
		config(
			p.home,
			'{"tune": {"send_report": false}, "top": {"ambiguous_width": 2, "braille": true}}',
		);
		expect((await run(["--once"])).out).not.toContain(NOTICE);
	});

	it("counts ambiguous width characters as 2 when ambiguous_width is 2", async () => {
		const { run, p } = setup({
			a: transcript("a", -10, { branch: "feature/日本語" }),
		});
		config(p.home, '{"top": {"ambiguous_width": 2}}');
		const out = (await run(["--once"])).out;
		for (const l of out.split("\n")) {
			const width = [...l].reduce(
				(sum, c) =>
					sum +
					(/[●○✕]/.test(c) ? (c === "✕" ? 1 : 2) : /[぀-鿿]/.test(c) ? 2 : 1),
				0,
			);
			expect(width).toBeLessThanOrEqual(80);
		}
	});

	it("picks up appended lines only through the next run (each run reads afresh)", async () => {
		const { run, p } = setup({ a: transcript("a", -10) });
		const first = JSON.parse((await run(["--json"])).out).sessions[0]
			.tool_calls;
		appendFileSync(p.write("b", transcript("b", -10)), "");
		const second = JSON.parse((await run(["--json"])).out).sessions;
		expect(first).toBe(3);
		expect(second).toHaveLength(2);
	});
});
