import { describe, expect, it } from "vitest";
import { stripSgr } from "../../src/top/width.js";
import { runCli } from "../support/cli.js";
import {
	fakeTty,
	gitWithRemote,
	NOW,
	projects,
	transcript,
} from "./support.js";

const ENTER_ALT = "\x1b[?1049h";
const RESTORE = "\x1b[?25h\x1b[?1049l";
// 背景色（40から47、100から107、48）と反転（7）。
// biome-ignore lint/suspicious/noControlCharactersInRegex: 端末の制御文字を扱うtest。
const BACKGROUND_OR_REVERSE = /\x1b\[(?:4[0-7]|10[0-7]|48|7)[;m]/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// 実際のfile読み込みを待つため、条件が満たされるまで短い間隔で確かめる。
async function until(condition: () => boolean, limitMs = 3000) {
	const began = Date.now();
	while (!condition()) {
		if (Date.now() - began > limitMs) throw new Error("condition not reached");
		await sleep(5);
	}
}

function start(
	args: string[],
	options: {
		sessions?: Record<string, string>;
		tty?: Parameters<typeof fakeTty>[0];
		env?: Record<string, string>;
	} = {},
) {
	const p = projects();
	for (const [name, text] of Object.entries(
		options.sessions ?? {
			a: transcript("sess-aaaa1111", -10, { failures: 1 }),
		},
	))
		p.write(name, text);
	const tty = fakeTty(options.tty);
	const done = runCli(["top", ...args], {
		homeDir: p.home,
		managedDir: "/nonexistent/hf-managed",
		importGit: gitWithRemote,
		now: () => new Date(NOW),
		top: tty.io,
		env: options.env ?? {},
	});
	return { tty, done, p };
}

const ready = (tty: ReturnType<typeof fakeTty>) =>
	until(() => lastFrame(tty) !== "");
const lastFrame = (tty: ReturnType<typeof fakeTty>) =>
	[...tty.writes].reverse().find((w) => w.startsWith("\x1b[H")) ?? "";

describe("the interactive screen", () => {
	it.each([
		["q", "q"],
		["Ctrl-C", "\x03"],
	])("restores the alternate screen, the cursor and the input when %s quits", async (_name, key) => {
		const { tty, done } = start(["--theme", "ansi"]);
		await ready(tty);
		expect(tty.text()).toContain(ENTER_ALT);
		expect(tty.state().raw).toBe(true);
		tty.key(key);
		const result = await done;
		expect(result.code).toBe(0);
		expect(tty.text().endsWith(RESTORE)).toBe(true);
		expect(tty.state()).toEqual({
			raw: false,
			paused: true,
			listeners: 0,
			resizeListeners: 0,
			exitListeners: 0,
		});
		expect(tty.activeTimers()).toBe(0);
	});

	it("restores the terminal when the process exits abnormally", async () => {
		const { tty, done } = start(["--theme", "ansi"]);
		await ready(tty);
		tty.processExit();
		expect(tty.text()).toContain(RESTORE);
		tty.key("q");
		await done;
		expect(tty.text().split(RESTORE).length - 1).toBe(1);
	});

	it("writes no background color and no reverse in any color mode", async () => {
		for (const theme of ["light", "dark", "ansi", "auto"]) {
			const { tty, done } = start(["--theme", theme], {
				tty: { oscAnswer: "\x1b]11;rgb:0000/0000/0000\x07" },
			});
			await ready(tty);
			tty.tick(100);
			await ready(tty);
			tty.key("q");
			await done;
			expect(tty.text()).not.toMatch(BACKGROUND_OR_REVERSE);
		}
	});

	it("on a white background leaves out status-good but colors status-critical", async () => {
		const { tty, done } = start(["--theme", "light"], {
			sessions: {
				a: transcript("sess-aaaa1111", -10, { failures: 1 }),
				b: transcript("sess-bbbb2222", -10),
			},
		});
		await ready(tty);
		const frame = lastFrame(tty);
		expect(frame).toContain("38;2;208;55;54");
		expect(frame).not.toContain("38;2;72;205;140");
		expect(stripSgr(frame)).toContain("● active");
		tty.key("q");
		await done;
	});

	it("asks the terminal for its background once, before the alternate screen, and uses the answer", async () => {
		const { tty, done } = start(["--theme", "auto"], {
			tty: { oscAnswer: "\x1b]11;rgb:ffff/ffff/ffff\x07" },
		});
		await ready(tty);
		const text = tty.text();
		expect(text.split("\x1b]11;?\x07").length - 1).toBe(1);
		expect(text.indexOf("\x1b]11;?")).toBeLessThan(text.indexOf(ENTER_ALT));
		expect(lastFrame(tty)).toContain("38;2;42;100;216");
		tty.key("q");
		await done;
	});

	it("falls back to the terminal's 16 colors when the answer does not come within 100 ms", async () => {
		const { tty, done } = start(["--theme", "auto"]);
		await until(() => tty.text().includes("\x1b]11;?"));
		expect(tty.text()).not.toContain(ENTER_ALT);
		tty.tick(100);
		await ready(tty);
		expect(tty.text()).toContain(ENTER_ALT);
		const frame = lastFrame(tty);
		expect(frame).not.toContain("38;2");
		expect(frame).not.toContain("38;5");
		tty.key("q");
		await done;
	});

	it("uses no color with NO_COLOR, and the frame equals the colored frame without escapes", async () => {
		const colored = start(["--theme", "dark"]);
		await ready(colored.tty);
		const coloredFrame = lastFrame(colored.tty);
		colored.tty.key("q");
		await colored.done;
		const plain = start(["--theme", "dark"], { env: { NO_COLOR: "1" } });
		await ready(plain.tty);
		const plainFrame = lastFrame(plain.tty);
		plain.tty.key("q");
		await plain.done;
		// biome-ignore lint/suspicious/noControlCharactersInRegex: 端末の制御文字を扱うtest。
		expect(plainFrame).not.toMatch(/\x1b\[[0-9;]*m/);
		expect(stripSgr(coloredFrame)).toBe(plainFrame);
	});

	it("moves the selection, opens and closes the detail of a session", async () => {
		const { tty, done } = start(["--theme", "ansi"], {
			sessions: {
				a: transcript("sess-aaaa1111", -10),
				b: transcript("sess-bbbb2222", -20, { branch: "bugfix/two" }),
			},
		});
		await ready(tty);
		expect(stripSgr(lastFrame(tty))).toMatch(/> .*feature\/ENG-42/);
		tty.key("\x1b[B");
		expect(stripSgr(lastFrame(tty))).toMatch(/> .*bugfix\/two/);
		tty.key("\r");
		const detail = stripSgr(lastFrame(tty));
		expect(detail).toContain("sess-bbb");
		expect(detail).toContain("tokens per hour");
		tty.key("\x1b");
		expect(stripSgr(lastFrame(tty))).toContain("STATE");
		tty.key("k");
		expect(stripSgr(lastFrame(tty))).toMatch(/> .*feature\/ENG-42/);
		tty.key("q");
		await done;
	});

	it("filters the rows by typed text and clears the filter with Esc", async () => {
		const { tty, done } = start(["--theme", "ansi"], {
			sessions: {
				a: transcript("sess-aaaa1111", -10),
				b: transcript("sess-bbbb2222", -20, { branch: "bugfix/two" }),
			},
		});
		await ready(tty);
		tty.key("/");
		for (const c of "two") tty.key(c);
		tty.key("\r");
		const filtered = stripSgr(lastFrame(tty));
		expect(filtered).toContain("bugfix/two");
		expect(filtered).not.toContain("feature/ENG-42");
		tty.key("/");
		tty.key("\x1b");
		expect(stripSgr(lastFrame(tty))).toContain("feature/ENG-42");
		tty.key("q");
		await done;
	});

	it("cycles the sort order with s, naming it in the header", async () => {
		const { tty, done } = start(["--theme", "ansi"]);
		await ready(tty);
		const seen = new Set<string>();
		for (let i = 0; i < 4; i += 1) {
			tty.key("s");
			seen.add(/sort: ([a-z ]+)/.exec(stripSgr(lastFrame(tty)))?.[1] ?? "");
		}
		expect(seen.size).toBe(4);
		tty.key("q");
		await done;
	});

	it("refreshes every 2 seconds, and stops while paused until r", async () => {
		const { tty, done, p } = start(["--theme", "ansi"]);
		await ready(tty);
		p.write("b", transcript("sess-bbbb2222", -5, { branch: "bugfix/two" }));
		tty.key("p");
		expect(stripSgr(lastFrame(tty))).toContain("paused");
		tty.tick(2000);
		await sleep(80);
		expect(stripSgr(lastFrame(tty))).not.toContain("bugfix/two");
		tty.key("r");
		await until(() => stripSgr(lastFrame(tty)).includes("bugfix/two"));
		tty.key("p");
		expect(stripSgr(lastFrame(tty))).not.toContain("paused");
		tty.key("q");
		await done;
	});

	it("picks up a new session on the 2 second refresh", async () => {
		const { tty, done, p } = start(["--theme", "ansi"]);
		await ready(tty);
		p.write("b", transcript("sess-bbbb2222", -5, { branch: "bugfix/two" }));
		tty.tick(2000);
		await until(() => stripSgr(lastFrame(tty)).includes("bugfix/two"));
		tty.key("q");
		await done;
	});

	it("redraws at the new width when the terminal is resized", async () => {
		const { tty, done } = start(["--theme", "ansi"]);
		await ready(tty);
		(tty.io as { columns: number }).columns = 45;
		tty.resize();
		const lines = stripSgr(lastFrame(tty))
			.replace("\x1b[H", "")
			.split("\x1b[K");
		for (const l of lines)
			expect([...l.replace(/[\r\n]/g, "")].length).toBeLessThanOrEqual(45);
		tty.key("q");
		await done;
	});

	it("shows the keys with ?", async () => {
		const { tty, done } = start(["--theme", "ansi"]);
		await ready(tty);
		tty.key("?");
		expect(stripSgr(lastFrame(tty))).toContain("Ctrl-C");
		tty.key("x");
		expect(stripSgr(lastFrame(tty))).toContain("STATE");
		tty.key("q");
		await done;
	});

	it("never prints a body or a path", async () => {
		const { tty, done } = start(["--theme", "ansi"]);
		await ready(tty);
		tty.key("\r");
		tty.key("\x1b");
		const text = tty.text();
		expect(text).not.toContain("SECRET");
		expect(text).not.toContain("/work/web");
		tty.key("q");
		await done;
	});

	// 選択と詳細はsessionで覚える。並びが入れ替わっても別のsessionに飛ばない。
	it("keeps the selected session when a refresh reorders the rows", async () => {
		const { tty, done, p } = start(["--theme", "ansi"], {
			sessions: {
				a: transcript("sess-aaaa1111", -20),
				b: transcript("sess-bbbb2222", -30, { branch: "bugfix/two" }),
			},
		});
		await ready(tty);
		tty.key("j");
		expect(stripSgr(lastFrame(tty))).toMatch(/> .*bugfix\/two/);
		// 最後のeventが最も新しいsessionが加わり、先頭に来る。
		p.write("c", transcript("sess-cccc3333", -1, { branch: "feature/three" }));
		tty.tick(2000);
		await until(() => stripSgr(lastFrame(tty)).includes("feature/three"));
		expect(stripSgr(lastFrame(tty))).toMatch(/> .*bugfix\/two/);
		tty.key("\r");
		expect(stripSgr(lastFrame(tty))).toContain("sess-bbb");
		p.write("d", transcript("sess-dddd4444", 0, { branch: "feature/four" }));
		tty.tick(2000);
		await until(() => stripSgr(lastFrame(tty)).includes("sess-bbb") && true);
		await sleep(80);
		expect(stripSgr(lastFrame(tty))).toContain("sess-bbb");
		tty.key("q");
		await done;
	});

	it("ignores a late answer to the background question instead of treating it as keys", async () => {
		const { tty, done } = start(["--theme", "auto"]);
		await until(() => tty.text().includes("\x1b]11;?"));
		tty.tick(100);
		await ready(tty);
		const before = tty.writes.length;
		// 100msを過ぎて届いた応答の中のrとsとpは操作として効かない。
		tty.key("\x1b]11;rgb:ffff/ffff/ffff\x07");
		expect(stripSgr(lastFrame(tty))).not.toContain("paused");
		expect(tty.writes.length).toBe(before);
		tty.key("q");
		await done;
	});

	it("does not clear the filter on an arrow key", async () => {
		const { tty, done } = start(["--theme", "ansi"]);
		await ready(tty);
		tty.key("/");
		tty.key("f");
		tty.key("\x1b[C");
		tty.key("\r");
		expect(stripSgr(lastFrame(tty))).toContain("filter: f");
		tty.key("q");
		await done;
	});
});
