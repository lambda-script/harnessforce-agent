import { type ColorToken, type Painter, plainPainter } from "./frame.js";

export type Rgb = readonly [number, number, number];
export type Theme = "auto" | "light" | "dark" | "ansi";
export type ColorDepth = 1 | 4 | 8 | 24;

// terminal-view.md「配色」手順4: 対比がこの値に満たない色は使わない。
const MIN_CONTRAST = 3;

// docs/specs/architecture/design-system.md「色」「状態色」「チャートのカテゴリ用パレット」の値。
// 状態色はlightとdarkで同じ値。値を変えるときはdesign-system.mdと同時に変える。
const TOKEN_VALUES: Record<ColorToken, readonly Rgb[]> = {
	good: [[0x48, 0xcd, 0x8c]],
	warning: [[0xf7, 0xb8, 0x28]],
	serious: [[0xea, 0x80, 0x5b]],
	critical: [[0xd0, 0x37, 0x36]],
	// light、darkの順。
	primary: [
		[0x2a, 0x64, 0xd8],
		[0x6e, 0x9b, 0xf0],
	],
	chart1: [
		[0x39, 0x87, 0xe5],
		[0x2a, 0x78, 0xd6],
	],
};

// 端末のthemeが対比を担う16色。黒（30）、白（37）、明るい色（90から97）は使わない。
const ANSI_CODES: Record<ColorToken, number> = {
	good: 32,
	warning: 33,
	serious: 31,
	critical: 31,
	primary: 34,
	chart1: 34,
};

const LIGHT_BACKGROUND: Rgb = [255, 255, 255];
const DARK_BACKGROUND: Rgb = [0, 0, 0];

const channel = (value: number) => {
	const v = value / 255;
	return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) =>
	0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

// WCAGの相対輝度による対比。
export function contrastRatio(a: Rgb, b: Rgb): number {
	const [x, y] = [luminance(a), luminance(b)];
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// 端末への問い合わせ（OSC 11）の応答。`rgb:RRRR/GGGG/BBBB`の各成分は1から4桁の16進数。
export function parseOsc11(response: string): Rgb | undefined {
	const match =
		// biome-ignore lint/suspicious/noControlCharactersInRegex: 端末の制御文字を扱う。
		/\x1b\]11;rgb:([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})(?:\x07|\x1b\\)/.exec(
			response,
		);
	if (!match) return undefined;
	const [, r, g, b] = match as unknown as [string, string, string, string];
	const to8 = (hex: string) =>
		Math.round((Number.parseInt(hex, 16) / (16 ** hex.length - 1)) * 255);
	return [to8(r), to8(g), to8(b)];
}

// 環境変数COLORFGBGの背景の番号。0から6と8は暗い背景、7と15は明るい背景とみなす。
export function backgroundFromColorfgbg(
	value: string | undefined,
): Rgb | undefined {
	const last = value?.split(";").at(-1);
	if (last === undefined || !/^\d+$/.test(last)) return undefined;
	const index = Number(last);
	if (index === 7 || index === 15) return LIGHT_BACKGROUND;
	if ((index >= 0 && index <= 6) || index === 8) return DARK_BACKGROUND;
	return undefined;
}

const CUBE = [0, 95, 135, 175, 215, 255];
const nearestCube = (value: number) =>
	CUBE.reduce(
		(best, level, i) =>
			Math.abs(level - value) < Math.abs((CUBE[best] ?? 0) - value) ? i : best,
		0,
	);

// 256色の番号と、その番号が実際に描く色。
function toAnsi256(rgb: Rgb): { code: number; shown: Rgb } {
	const [r, g, b] = rgb.map(nearestCube) as [number, number, number];
	return {
		code: 16 + 36 * r + 6 * g + b,
		shown: [CUBE[r] ?? 0, CUBE[g] ?? 0, CUBE[b] ?? 0],
	};
}

type Input = {
	env: Readonly<Record<string, string | undefined>>;
	// process.stdout.getColorDepth()の値。
	colorDepth: ColorDepth;
	theme: Theme;
	// 端末への問い合わせ（OSC 11）で得た背景。
	oscBackground?: Rgb;
};

const open = (sgr: string, text: string, close: string) =>
	`\x1b[${sgr}m${text}\x1b[${close}m`;

function detectBackground(input: Input): Rgb | undefined {
	if (input.theme === "light") return LIGHT_BACKGROUND;
	if (input.theme === "dark") return DARK_BACKGROUND;
	if (input.theme === "ansi") return undefined;
	return input.oscBackground ?? backgroundFromColorfgbg(input.env.COLORFGBG);
}

// 手順1: `NO_COLOR`が空でない値で設定されている、または色の深さが1なら、色を使わない。
export const isColorDisabled = (
	env: Readonly<Record<string, string | undefined>>,
	colorDepth: ColorDepth,
): boolean => (env.NO_COLOR ?? "") !== "" || colorDepth === 1;

// 手順1から5。背景色の指定と反転は、どの経路でも出力しない。
export function createPainter(input: Input): Painter {
	if (isColorDisabled(input.env, input.colorDepth)) return plainPainter;
	const background = detectBackground(input);
	const useAnsi = background === undefined || input.colorDepth === 4;
	const colorOf = (token: ColorToken): string | undefined => {
		if (useAnsi) return String(ANSI_CODES[token]);
		const candidates = TOKEN_VALUES[token].map((rgb) =>
			input.colorDepth === 8
				? { rgb: toAnsi256(rgb).shown, sgr: `38;5;${toAnsi256(rgb).code}` }
				: { rgb, sgr: `38;2;${rgb.join(";")}` },
		);
		const best = candidates.reduce((a, b) =>
			contrastRatio(b.rgb, background) > contrastRatio(a.rgb, background)
				? b
				: a,
		);
		return contrastRatio(best.rgb, background) >= MIN_CONTRAST
			? best.sgr
			: undefined;
	};
	return {
		color: (token, text) => {
			const sgr = colorOf(token);
			return sgr === undefined ? text : open(sgr, text, "39");
		},
		bold: (text) => open("1", text, "22"),
		dim: (text) => open("2", text, "22"),
	};
}
