import type { ColorDepth } from "./color.js";

// 端末とtimerの境界。画面の操作をtestで動かせるよう、processの代わりに渡す。
export type TopIo = {
	// 標準入力と標準出力がどちらも端末か。
	isTty: boolean;
	// 標準出力の桁数。画面を描くたびに読む。端末でなければundefined。
	columns: number | undefined;
	// process.stdout.getColorDepth()の値。
	colorDepth: ColorDepth;
	// 画面の制御と描画を端末へ書く。
	write(text: string): void;
	// 標準入力のdata。購読の解除を返す。
	onData(callback: (chunk: string) => void): () => void;
	setRawMode(enabled: boolean): void;
	setPaused(paused: boolean): void;
	onResize(callback: () => void): () => void;
	// processが終わるときに呼ぶ。異常終了でも画面をもとに戻すために使う。
	onProcessExit(callback: () => void): () => void;
	setInterval(callback: () => void, ms: number): () => void;
	setTimeout(callback: () => void, ms: number): () => void;
};

// 標準出力が端末でない、または桁数が分からないときの桁数。
export const DEFAULT_COLUMNS = 80;
