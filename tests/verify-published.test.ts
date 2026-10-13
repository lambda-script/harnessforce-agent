import { describe, expect, it } from "vitest";
import {
	npmView,
	VIEW_ATTEMPTS,
	VIEW_INTERVAL_MS,
	verifyPublished,
} from "../scripts/verify-published.mjs";

describe("verifyPublished", () => {
	const published = [{ name: "@harnessforce/semconv", version: "0.1.0" }];

	it("passes when the registry serves every published version", async () =>
		await expect(
			verifyPublished(published, async () => "0.1.0"),
		).resolves.toBeUndefined());

	it("fails when the registry lags behind main", async () =>
		await expect(verifyPublished(published, async () => "")).rejects.toThrow(
			"@harnessforce/semconv@0.1.0",
		));
});

describe("npmView", () => {
	it("waits at least five minutes for a version that appears late", async () => {
		const waits: number[] = [];
		let calls = 0;
		const viewOnce = async () => {
			calls += 1;
			return calls > 15 ? "0.1.0" : "";
		};
		await expect(
			npmView("@harnessforce/cli@0.1.0", {
				viewOnce,
				wait: async (ms) => {
					waits.push(ms);
				},
			}),
		).resolves.toBe("0.1.0");
		expect(waits.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThanOrEqual(
			5 * 60_000,
		);
	});

	it("gives up after the attempt limit without waiting after the last try", async () => {
		const waits: number[] = [];
		let calls = 0;
		await expect(
			npmView("@harnessforce/cli@0.1.0", {
				viewOnce: async () => {
					calls += 1;
					return "";
				},
				wait: async (ms) => {
					waits.push(ms);
				},
			}),
		).resolves.toBe("");
		expect(calls).toBe(VIEW_ATTEMPTS);
		expect(waits).toHaveLength(VIEW_ATTEMPTS - 1);
		expect(waits.every((ms) => ms === VIEW_INTERVAL_MS)).toBe(true);
	});
});
