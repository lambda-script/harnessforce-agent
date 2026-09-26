import { describe, expect, it } from "vitest";
import { verifyPublished } from "../scripts/verify-published.mjs";

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
