import { describe, expect, it } from "vitest";
import { createPainter } from "../../src/top/color.js";
import {
	type ColorToken,
	type Painter,
	plainPainter,
	renderDetail,
	renderList,
} from "../../src/top/frame.js";
import type { TopRow } from "../../src/top/reader.js";
import { displayWidth, stripSgr } from "../../src/top/width.js";

const NOW = Date.parse("2026-10-09T12:00:00Z");

function row(overrides: Partial<TopRow> = {}): TopRow {
	return {
		agent: "claude",
		sessionId: "sess-1234abcd",
		cwd: "/work/web",
		repository: "github.com/acme/web",
		branch: "feature/ENG-42",
		model: "claude-opus-5-5",
		startedAtMs: NOW - 12 * 60_000,
		lastEventAtMs: NOW - 5_000,
		tokens: {
			input: 84_200,
			output: 4_100,
			cacheRead: 1_200_000,
			cacheWrite: 31_000,
		},
		contextTokens: 84_000,
		toolCalls: 38,
		toolFailures: 2,
		tools: [
			{ tool: "Bash", calls: 30, failures: 2 },
			{ tool: "Edit", calls: 8, failures: 0 },
		],
		models: [{ model: "claude-opus-5-5", responses: 14 }],
		hourlyTokens: [
			{ hourStartMs: Date.parse("2026-10-09T11:00:00Z"), tokens: 5000 },
		],
		...overrides,
	};
}

const options = (width: number, extra: object = {}) => ({
	width,
	ascii: false,
	ambiguousWide: false,
	nowMs: NOW,
	painter: plainPainter,
	selectedIndex: 0,
	notices: [] as string[],
	paused: false,
	...extra,
});

const widest = (lines: string[], ambiguousWide = false) =>
	Math.max(...lines.map((l) => displayWidth(l, ambiguousWide)));

const sessions = [
	row(),
	row({
		sessionId: "sess-idle0000",
		branch: "bugfix/日本語のブランチ名-長い長い長い",
		lastEventAtMs: NOW - 61_000,
		toolFailures: 0,
		tools: [{ tool: "Read", calls: 3, failures: 0 }],
		toolCalls: 3,
	}),
];

// terminal-view.md「本人の表示」「行」「端末への適応」。
describe("the session list", () => {
	it.each([
		40, 41, 59, 60, 80, 89, 90, 120,
	])("does not wrap at %i columns, with Japanese branch names too", (width) => {
		const lines = renderList(sessions, options(width));
		expect(widest(lines)).toBeLessThanOrEqual(width);
	});

	it("keeps the width with ambiguous width characters counted as 2", () => {
		const lines = renderList(sessions, options(80, { ambiguousWide: true }));
		expect(widest(lines, true)).toBeLessThanOrEqual(80);
	});

	it("shows only the counts below 40 columns", () => {
		const lines = renderList(sessions, options(30));
		expect(lines.join("\n")).toContain("2");
		expect(lines.join("\n")).not.toContain("feature/ENG-42");
		expect(widest(lines)).toBeLessThanOrEqual(30);
	});

	it("drops the token and context columns from 89 columns down", () => {
		const wide = renderList(sessions, options(90)).join("\n");
		const narrow = renderList(sessions, options(89)).join("\n");
		expect(wide).toContain("CONTEXT");
		expect(narrow).not.toContain("CONTEXT");
		expect(narrow).toContain("MODEL");
	});

	it("tells the states and the tool failures apart by symbol and label, without color", () => {
		const text = renderList(sessions, options(100)).join("\n");
		expect(text).toContain("● active");
		expect(text).toContain("○ idle");
		expect(text).toContain("✕ 2/38");
		expect(text).toContain("0/3");
	});

	it("uses only ASCII symbols with --ascii", () => {
		const lines = renderList(
			[row({ branch: "main" })],
			options(100, { ascii: true }),
		);
		expect(lines.join("\n")).toMatch(/^[\x20-\x7e\n]*$/);
		expect(lines.join("\n")).toContain("* active");
		expect(lines.join("\n")).toContain("x 2/38");
	});

	it("leaves tokens and context empty, never zero, without usage", () => {
		const bare = row({
			tokens: undefined,
			contextTokens: undefined,
			toolCalls: 3,
			toolFailures: 1,
			startedAtMs: NOW - 5 * 60_000,
			sessionId: "sess-bare",
		});
		const [, line] = renderList([bare], options(120));
		expect(stripSgr(line ?? "")).not.toContain("0");
	});

	it("never shows a context percentage, a cost or any body", () => {
		const text = [
			...renderList(sessions, options(120)),
			...renderDetail(sessions[0] as TopRow, options(120)),
		].join("\n");
		expect(text).not.toContain("%");
		expect(text).not.toContain("$");
		expect(text).not.toContain("SECRET");
	});

	it("marks the selected row and says so when there are no sessions", () => {
		const lines = renderList(sessions, options(100, { selectedIndex: 1 }));
		expect(lines.find((l) => l.startsWith(">"))).toContain("bugfix");
		expect(renderList([], options(100)).join("\n")).toContain("直近24時間");
	});

	it("shows the notices and the key hint, paused included", () => {
		const text = renderList(
			sessions,
			options(100, {
				notices: ["読めなかった2行を読み飛ばしました"],
				paused: true,
			}),
		).join("\n");
		expect(text).toContain("読めなかった2行を読み飛ばしました");
		expect(text).toContain("paused");
		expect(text).toContain("q quit");
	});
});

describe("colors in the frame", () => {
	function recording() {
		const calls: [ColorToken, string][] = [];
		const painter: Painter = {
			color: (token, text) => {
				calls.push([token, text]);
				return `\x1b[38;5;1m${text}\x1b[39m`;
			},
			bold: (text) => `\x1b[1m${text}\x1b[22m`,
			dim: (text) => `\x1b[2m${text}\x1b[22m`,
		};
		return { painter, calls };
	}

	it("equals the plain frame once the escapes are stripped", () => {
		const { painter } = recording();
		const colored = renderList(sessions, options(100, { painter }));
		const plain = renderList(sessions, options(100));
		expect(colored.map(stripSgr)).toEqual(plain);
		expect(colored.join("")).toContain("\x1b[");
	});

	it("colors only symbols with the state colors, and the selection mark with primary", () => {
		const { painter, calls } = recording();
		renderList(sessions, options(100, { painter }));
		expect(calls).toContainEqual(["good", "●"]);
		expect(calls).toContainEqual(["warning", "○"]);
		expect(calls).toContainEqual(["critical", "✕"]);
		expect(calls).toContainEqual(["primary", ">"]);
		for (const [, text] of calls)
			expect(displayWidth(text, false)).toBeLessThanOrEqual(1);
	});

	it("does not color counts or amounts as good or bad", () => {
		const { painter, calls } = recording();
		renderList(sessions, options(100, { painter }));
		renderDetail(sessions[0] as TopRow, options(100, { painter }));
		const textsColored = calls.map(([, text]) => text).join("");
		expect(textsColored).not.toMatch(/[0-9]/);
	});
});

describe("the session detail", () => {
	it("shows tokens, the hourly series, and tools by name without their input or output", () => {
		const text = renderDetail(sessions[0] as TopRow, options(100)).join("\n");
		expect(text).toContain("sess-123");
		expect(text).toContain("Bash");
		expect(text).toContain("30");
		expect(text).toContain("✕ 2");
		expect(text).toContain("claude-opus-5-5");
		expect(text).toContain("cache");
	});

	it("does not wrap in a narrow terminal", () => {
		expect(
			widest(renderDetail(sessions[0] as TopRow, options(40))),
		).toBeLessThanOrEqual(40);
	});

	// terminal-view.md「描画」「形」: 点字は設定のbrailleが真のときだけ使い、--asciiでは使わない。
	it("draws the hourly tokens with braille only when the setting is on and --ascii is off", () => {
		const braille = /[\u2800-\u28ff]/;
		const base = sessions[0] as TopRow;
		expect(
			renderDetail(base, options(100, { braille: true })).join("\n"),
		).toMatch(braille);
		expect(renderDetail(base, options(100)).join("\n")).not.toMatch(braille);
		expect(
			renderDetail(base, options(100, { braille: true, ascii: true })).join(
				"\n",
			),
		).not.toMatch(braille);
	});
});

// 色を実際に付けても、幅を守り、escapeを途中で切らず、開いた色を閉じる。
describe("a colored frame at every width", () => {
	const painter = createPainter({ env: {}, colorDepth: 24, theme: "dark" });
	const many = [
		row({ toolFailures: 120, toolCalls: 1500 }),
		row({
			sessionId: "sess-idle",
			lastEventAtMs: NOW - 90_000,
			branch: "bugfix/日本語のブランチ名-長い長い",
		}),
	];

	it.each([
		40, 45, 59, 62, 70, 89, 100, 140,
	])("keeps %i columns and balanced escapes", (width) => {
		const lines = [
			...renderList(many, options(width, { painter })),
			...renderDetail(many[0] as TopRow, options(width, { painter })),
		];
		for (const l of lines) {
			expect(displayWidth(l, false)).toBeLessThanOrEqual(width);
			// 完結したSGRを除いた後に、escapeの断片が残らない。
			expect(stripSgr(l)).not.toContain("\x1b");
			// 最後の指定は、色、太さ、薄さのいずれも閉じている。
			// biome-ignore lint/suspicious/noControlCharactersInRegex: 端末の制御文字を扱うtest。
			const last = [...l.matchAll(/\x1b\[([0-9;]*)m/g)].at(-1)?.[1];
			if (last !== undefined) expect(["0", "22", "39"]).toContain(last);
		}
	});
});

const codexRow = (overrides: Partial<TopRow> = {}) =>
	row({
		agent: "codex",
		sessionId: "codex-1234",
		model: "gpt-5-codex",
		toolFailures: undefined,
		toolCalls: 3,
		tools: [{ tool: "shell_command", calls: 3, failures: undefined }],
		...overrides,
	});

// terminal-view.md「行」: agentは文字で示し、Codexのtoolの失敗は空欄にする。
describe("Codex rows", () => {
	it.each([
		40, 59, 60, 89, 90, 120,
	])("shows the agent as text and does not wrap at %i columns", (width) => {
		const lines = renderList([row(), codexRow()], options(width));
		const text = lines.join("\n");
		expect(text).toContain("claude");
		expect(text).toContain("codex");
		expect(widest(lines)).toBeLessThanOrEqual(width);
	});

	it("puts the agent first in the short form", () => {
		const lines = renderList([codexRow()], options(50));
		expect(lines[1]).toMatch(/^[> ] codex /);
	});

	it("shows the call count only, with no failure mark, when the failures are blank", () => {
		const text = renderList([codexRow()], options(100)).join("\n");
		expect(text).not.toContain("✕");
		expect(text).not.toContain("0/3");
		expect(text).toMatch(/\b3\b/);
	});

	it("leaves the Codex rows out of the header's failure total", () => {
		const header = renderList([row(), codexRow()], options(100))[0];
		expect(header).toContain("2 tool failures");
	});

	it("shows the tool names of a Codex session without failure marks", () => {
		const text = renderDetail(codexRow(), options(100)).join("\n");
		expect(text).toContain("shell_command");
		expect(text).not.toContain("✕");
	});
});
