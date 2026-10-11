// SGR（色と太さの指定）。表示の幅には数えない。
// biome-ignore lint/suspicious/noControlCharactersInRegex: 端末の制御文字を扱う。
const SGR = /\x1b\[[0-9;]*m/g;

export const stripSgr = (text: string): string => text.replace(SGR, "");

// 東アジアの全角と、絵文字の手前までの全角の記号の範囲（2桁）。
const WIDE_RANGES: readonly (readonly [number, number])[] = [
	[0x1100, 0x115f],
	[0x2e80, 0x303e],
	[0x3041, 0x33ff],
	[0x3400, 0x4dbf],
	[0x4e00, 0x9fff],
	[0xa000, 0xa4cf],
	[0xac00, 0xd7a3],
	[0xf900, 0xfaff],
	[0xfe30, 0xfe6f],
	[0xff00, 0xff60],
	[0xffe0, 0xffe6],
	[0x20000, 0x3fffd],
];

// Unicodeの「曖昧な幅」のうち、この表示が使う記号。東アジアの設定の端末では2桁に描かれる。
// 罫線とブロックと幾何図形（U+2500からU+25FF）、中黒、三点リーダー、矢印。
const AMBIGUOUS_RANGES: readonly (readonly [number, number])[] = [
	[0x00b7, 0x00b7],
	[0x2026, 0x2026],
	[0x2190, 0x2199],
	[0x2500, 0x25ff],
];

// 結合文字と幅を持たない文字。
const ZERO_WIDTH: readonly (readonly [number, number])[] = [
	[0x0300, 0x036f],
	[0x200b, 0x200f],
	[0xfe00, 0xfe0f],
];

const within = (
	code: number,
	ranges: readonly (readonly [number, number])[],
): boolean => ranges.some(([from, to]) => code >= from && code <= to);

function charWidth(code: number, ambiguousWide: boolean): number {
	if (within(code, ZERO_WIDTH)) return 0;
	if (within(code, WIDE_RANGES)) return 2;
	if (ambiguousWide && within(code, AMBIGUOUS_RANGES)) return 2;
	return 1;
}

// 文字の幅の合計。ambiguousWideは設定のambiguous_widthが2のとき真。
export function displayWidth(text: string, ambiguousWide: boolean): number {
	let width = 0;
	for (const char of stripSgr(text))
		width += charWidth(char.codePointAt(0) ?? 0, ambiguousWide);
	return width;
}

// SGRか1文字。SGRは幅を持たない塊として扱い、途中で切らない。
// biome-ignore lint/suspicious/noControlCharactersInRegex: 端末の制御文字を扱う。
const SGR_OR_CHAR = /\x1b\[[0-9;]*m|[\s\S]/gu;
const RESET = "\x1b[0m";

// 文字の途中で切らず、幅に収める。収まらないときは末尾にellipsisを付ける。
// 色や太さを開いたまま切った場合は、後ろの描画へ漏れないよう閉じる。
export function truncate(
	text: string,
	maxWidth: number,
	ambiguousWide: boolean,
	ellipsis: string,
): string {
	if (displayWidth(text, ambiguousWide) <= maxWidth) return text;
	const room = maxWidth - displayWidth(ellipsis, ambiguousWide);
	if (room < 0) return "";
	let out = "";
	let width = 0;
	let styled = false;
	for (const [token] of text.matchAll(SGR_OR_CHAR)) {
		if (token.startsWith("\x1b")) {
			out += token;
			styled = true;
			continue;
		}
		const next = charWidth(token.codePointAt(0) ?? 0, ambiguousWide);
		if (width + next > room) break;
		out += token;
		width += next;
	}
	return out + ellipsis + (styled ? RESET : "");
}

export function padEnd(
	text: string,
	width: number,
	ambiguousWide: boolean,
): string {
	return (
		text + " ".repeat(Math.max(0, width - displayWidth(text, ambiguousWide)))
	);
}
