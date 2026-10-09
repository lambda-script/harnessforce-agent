import { describe, expect, it } from "vitest";
import {
	backgroundFromColorfgbg,
	contrastRatio,
	createPainter,
	parseOsc11,
	type Rgb,
} from "../../src/top/color.js";
import type { ColorToken } from "../../src/top/frame.js";

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const TOKENS: ColorToken[] = [
	"good",
	"warning",
	"serious",
	"critical",
	"primary",
	"chart1",
];

type Theme = "auto" | "light" | "dark" | "ansi";
function painter(
	theme: Theme,
	depth: 1 | 4 | 8 | 24 = 24,
	extra: { env?: Record<string, string>; background?: Rgb } = {},
) {
	return createPainter({
		env: extra.env ?? {},
		colorDepth: depth,
		theme,
		...(extra.background ? { oscBackground: extra.background } : {}),
	});
}
const paintAll = (p: ReturnType<typeof painter>) =>
	TOKENS.map((t) => p.color(t, "X")).join("") + p.bold("B") + p.dim("D");

// terminal-view.md「配色」の手順1から5。
describe("contrast and background detection", () => {
	it("computes the WCAG ratio", () => {
		expect(contrastRatio([0x48, 0xcd, 0x8c], WHITE)).toBeCloseTo(2.02, 1);
		expect(contrastRatio([0xd0, 0x37, 0x36], WHITE)).toBeCloseTo(4.9, 1);
		expect(contrastRatio([0x6e, 0x9b, 0xf0], BLACK)).toBeCloseTo(7.6, 1);
		expect(contrastRatio([0x2a, 0x64, 0xd8], BLACK)).toBeCloseTo(3.9, 1);
	});

	it("reads the OSC 11 answer in 16, 8 and 4 hex digits per channel, ended by BEL or ST", () => {
		expect(parseOsc11("\x1b]11;rgb:ffff/ffff/ffff\x07")).toEqual(WHITE);
		expect(parseOsc11("\x1b]11;rgb:00/00/00\x1b\\")).toEqual(BLACK);
		expect(parseOsc11("\x1b]11;rgb:1f1f/2020/2121\x07")).toEqual([31, 32, 33]);
		expect(parseOsc11("garbage")).toBeUndefined();
	});

	it("reads the background number of COLORFGBG as a dark or a light background", () => {
		expect(backgroundFromColorfgbg("15;0")).toEqual(BLACK);
		expect(backgroundFromColorfgbg("0;15")).toEqual(WHITE);
		expect(backgroundFromColorfgbg("0;default;8")).toEqual(BLACK);
		expect(backgroundFromColorfgbg("0;7")).toEqual(WHITE);
		expect(backgroundFromColorfgbg(undefined)).toBeUndefined();
		expect(backgroundFromColorfgbg("x")).toBeUndefined();
	});
});

describe("choosing the colors", () => {
	it("uses no color with NO_COLOR or a color depth of 1, and writes no escape at all", () => {
		for (const p of [
			painter("dark", 24, { env: { NO_COLOR: "1" } }),
			painter("dark", 1),
		]) {
			expect(p.color("good", "X")).toBe("X");
			expect(p.bold("B")).toBe("B");
			expect(p.dim("D")).toBe("D");
		}
	});

	it("treats an empty NO_COLOR as unset", () => {
		expect(
			painter("dark", 24, { env: { NO_COLOR: "" } }).color("good", "X"),
		).toContain("\x1b[");
	});

	it("on a white background drops status-good (2.0:1) but keeps status-critical (4.9:1)", () => {
		const p = painter("light");
		expect(p.color("good", "●")).toBe("●");
		expect(p.color("critical", "✕")).toBe("\x1b[38;2;208;55;54m✕\x1b[39m");
	});

	it("on a black background uses the dark primary and keeps status-good", () => {
		const p = painter("dark");
		expect(p.color("primary", ">")).toBe("\x1b[38;2;110;155;240m>\x1b[39m");
		expect(p.color("good", "●")).toBe("\x1b[38;2;72;205;140m●\x1b[39m");
		expect(paintAll(p)).not.toContain("38;2;42;100;216");
	});

	it("picks the light or the dark value by the detected background, from OSC 11", () => {
		const onLight = painter("auto", 24, { background: WHITE });
		const onDark = painter("auto", 24, { background: BLACK });
		expect(onLight.color("primary", ">")).toContain("38;2;42;100;216");
		expect(onDark.color("primary", ">")).toContain("38;2;110;155;240");
	});

	it("falls back to COLORFGBG when OSC 11 did not answer", () => {
		const p = createPainter({
			env: { COLORFGBG: "0;15" },
			colorDepth: 24,
			theme: "auto",
		});
		expect(p.color("primary", ">")).toContain("38;2;42;100;216");
	});

	it("uses the terminal's own 16 colors when the background is unknown or theme is ansi", () => {
		for (const p of [
			painter("ansi"),
			painter("auto"),
			painter("auto", 4, { background: WHITE }),
		]) {
			const out = paintAll(p);
			expect(out).not.toContain("38;2");
			expect(out).not.toContain("38;5");
			// biome-ignore lint/suspicious/noControlCharactersInRegex: 端末の制御文字を扱うtest。
			const codes = [...out.matchAll(/\x1b\[(\d+)m/g)].map((m) => Number(m[1]));
			for (const code of codes.filter((c) => c >= 30 && c !== 39 && c < 100))
				expect([31, 32, 33, 34, 35, 36]).toContain(code);
			for (const forbidden of [30, 37, 90, 91, 92, 93, 94, 95, 96, 97])
				expect(codes).not.toContain(forbidden);
		}
	});

	it("uses 256-color numbers on a 256-color terminal, only when the rounded color still has 3:1", () => {
		const out = paintAll(painter("dark", 8));
		expect(out).toContain("38;5;");
		expect(out).not.toContain("38;2");
	});

	it("drops every color when no value reaches 3:1 on the detected background", () => {
		const p = painter("auto", 24, { background: [128, 128, 128] });
		for (const token of TOKENS) expect(p.color(token, "X")).toBe("X");
	});

	it("never writes a background color or a reverse", () => {
		for (const theme of ["auto", "light", "dark", "ansi"] as const)
			for (const depth of [4, 8, 24] as const) {
				const out = paintAll(painter(theme, depth, { background: BLACK }));
				// biome-ignore lint/suspicious/noControlCharactersInRegex: 端末の制御文字を扱うtest。
				const codes = [...out.matchAll(/\x1b\[([\d;]+)m/g)].flatMap((m) =>
					(m[1] ?? "").startsWith("38;") ? [] : [Number(m[1])],
				);
				for (const code of codes) {
					expect(code >= 40 && code <= 47).toBe(false);
					expect(code >= 100 && code <= 107).toBe(false);
					expect([48, 7]).not.toContain(code);
				}
			}
	});
});
