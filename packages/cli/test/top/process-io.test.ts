import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createProcessIo } from "../../src/top/process-io.js";

// terminal-view.md「command」: 異常終了でも、alternate screenとcursorをもとに戻す。
// Nodeはsignalによる終了で`exit`を発火しないため、SIGTERMとSIGHUPも購読する。
function fakeProcess() {
	const emitter = new EventEmitter();
	const exits: number[] = [];
	return {
		proc: Object.assign(emitter, {
			exit: (code: number) => {
				exits.push(code);
			},
			stdin: process.stdin,
			stdout: process.stdout,
		}),
		exits,
	};
}

describe("process io", () => {
	it("restores on exit, SIGTERM and SIGHUP, and ends the process with the signal's code", () => {
		const { proc, exits } = fakeProcess();
		const io = createProcessIo(proc);
		let restored = 0;
		const stop = io.onProcessExit(() => {
			restored += 1;
		});
		proc.emit("exit");
		proc.emit("SIGTERM");
		proc.emit("SIGHUP");
		expect(restored).toBe(3);
		expect(exits).toEqual([143, 129]);
		stop();
		expect(proc.listenerCount("exit")).toBe(0);
		expect(proc.listenerCount("SIGTERM")).toBe(0);
		expect(proc.listenerCount("SIGHUP")).toBe(0);
	});
});
