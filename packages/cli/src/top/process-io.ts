import { constants } from "node:os";
import type { ColorDepth } from "./color.js";
import type { TopIo } from "./io.js";

// 実際の標準入力、標準出力、processにつなぐ。画面の動きはtest/top/screen.test.tsがfakeで確かめる。
type ProcessLike = Pick<NodeJS.Process, "stdin" | "stdout"> & {
	on(event: string, listener: () => void): unknown;
	off(event: string, listener: () => void): unknown;
	exit(code: number): unknown;
};

// Nodeはsignalによる終了で`exit`を発火しないため、これらも購読して画面をもとに戻してから終える。
const EXIT_SIGNALS = ["SIGTERM", "SIGHUP"] as const;

export function createProcessIo(proc: ProcessLike = process): TopIo {
	const { stdin, stdout } = proc;
	return {
		isTty: Boolean(stdin.isTTY && stdout.isTTY),
		get columns() {
			return stdout.isTTY ? stdout.columns : undefined;
		},
		colorDepth: (stdout.isTTY ? stdout.getColorDepth() : 1) as ColorDepth,
		write: (text) => {
			stdout.write(text);
		},
		onData: (callback) => {
			stdin.setEncoding("utf8");
			stdin.on("data", callback);
			return () => {
				stdin.off("data", callback);
			};
		},
		setRawMode: (enabled) => {
			if (stdin.isTTY) stdin.setRawMode(enabled);
		},
		setPaused: (paused) => {
			if (paused) stdin.pause();
			else stdin.resume();
		},
		onResize: (callback) => {
			stdout.on("resize", callback);
			return () => {
				stdout.off("resize", callback);
			};
		},
		onProcessExit: (callback) => {
			const handlers = EXIT_SIGNALS.map((signal) => {
				const handler = () => {
					callback();
					proc.exit(128 + (constants.signals[signal] ?? 0));
				};
				return { signal, handler };
			});
			proc.on("exit", callback);
			for (const { signal, handler } of handlers) proc.on(signal, handler);
			return () => {
				proc.off("exit", callback);
				for (const { signal, handler } of handlers) proc.off(signal, handler);
			};
		},
		setInterval: (callback, ms) => {
			const timer = setInterval(callback, ms);
			return () => clearInterval(timer);
		},
		setTimeout: (callback, ms) => {
			const timer = setTimeout(callback, ms);
			return () => clearTimeout(timer);
		},
	};
}
