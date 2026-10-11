import { describe, expect, it } from "vitest";
import {
	displayWidth,
	padEnd,
	stripSgr,
	truncate,
} from "../../src/top/width.js";

// terminal-view.md「描画」「形」: 全角は2桁、曖昧な幅の文字は設定で1桁か2桁。
describe("display width", () => {
	it("counts ASCII as 1 and Japanese characters as 2", () => {
		expect(displayWidth("main", false)).toBe(4);
		expect(displayWidth("日本語", false)).toBe(6);
		expect(displayWidth("feature/ENG-42-日本語", false)).toBe(15 + 6);
	});

	it("counts the ambiguous width characters as 1 by default and 2 when asked", () => {
		for (const text of ["●", "○", "█", "░", "·", "…", "↑"]) {
			expect(displayWidth(text, false)).toBe(1);
			expect(displayWidth(text, true)).toBe(2);
		}
	});

	it("counts neutral symbols such as the cross mark and braille as 1", () => {
		expect(displayWidth("✕", true)).toBe(1);
		expect(displayWidth("⣿", true)).toBe(1);
	});

	it("does not count SGR escapes", () => {
		expect(displayWidth("\x1b[38;2;1;2;3m●\x1b[39m ok", false)).toBe(4);
		expect(stripSgr("\x1b[1mA\x1b[22m")).toBe("A");
	});
});

describe("truncate and pad", () => {
	it("cuts to the width without splitting a wide character and adds the ellipsis", () => {
		expect(truncate("feature/日本語ブランチ", 12, false, "…")).toBe(
			"feature/日…",
		);
		expect(
			displayWidth(truncate("feature/日本語ブランチ", 12, false, "…"), false),
		).toBeLessThanOrEqual(12);
		expect(truncate("short", 12, false, "…")).toBe("short");
	});

	it("pads to the width by display width", () => {
		expect(padEnd("日本", 6, false)).toBe("日本  ");
		expect(padEnd("abc", 2, false)).toBe("abc");
	});

	// 色を付けた文字列を切っても、escapeを途中で切らず、開いた色を閉じる。
	it("treats SGR as zero width when cutting and closes what it opened", () => {
		const cut = truncate("\x1b[38;2;1;2;3mabcdef\x1b[39m", 4, false, "…");
		expect(stripSgr(cut)).toBe("abc…");
		expect(displayWidth(cut, false)).toBeLessThanOrEqual(4);
		expect(cut.endsWith("\x1b[0m")).toBe(true);
		expect(truncate("\x1b[2mshort\x1b[22m", 20, false, "…")).toBe(
			"\x1b[2mshort\x1b[22m",
		);
	});

	it("counts a character outside the BMP as one wide character, not as an escape", () => {
		const cut = truncate("𠀀𠀀𠀀𠀀𠀀", 5, false, "…");
		expect(displayWidth(cut, false)).toBeLessThanOrEqual(5);
		expect(cut).toBe("𠀀𠀀…");
		expect(cut).not.toContain("\x1b");
	});
});
