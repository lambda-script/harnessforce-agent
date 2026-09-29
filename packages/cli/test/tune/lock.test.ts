import { existsSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { describe, expect, it } from "vitest";
import { acquireTuneLock } from "../../src/tune/lock.js";

// sleepのたびに時計を進める。
function clock(startMs = Date.now()) {
	let nowMs = startMs;
	return {
		now: () => nowMs,
		sleep: async (ms: number) => {
			nowMs += ms;
		},
	};
}

describe("acquireTuneLock", () => {
	it("creates the lock and removes it on release", async () => {
		const path = join(tempDir("hf-lock-"), ".lock");
		const release = await acquireTuneLock(path, clock());
		expect(existsSync(path)).toBe(true);
		await release?.();
		expect(existsSync(path)).toBe(false);
	});

	it("gives up after waiting 30 seconds for a live lock", async () => {
		const path = join(tempDir("hf-lock-"), ".lock");
		writeFileSync(path, "");
		const time = clock();
		expect(await acquireTuneLock(path, time)).toBeUndefined();
		expect(existsSync(path)).toBe(true);
	});

	it("takes over a lock whose modification time is more than 60 seconds old", async () => {
		const path = join(tempDir("hf-lock-"), ".lock");
		writeFileSync(path, "");
		const old = new Date(Date.now() - 61_000);
		utimesSync(path, old, old);
		const release = await acquireTuneLock(path, clock());
		expect(release).toBeTypeOf("function");
		await release?.();
	});
});
