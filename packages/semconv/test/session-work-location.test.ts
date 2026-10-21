import { compileSchema } from "@harnessforce/test-support/validator";
import { describe, expect, it } from "vitest";
import { SessionWorkLocationSchema } from "../src/schemas/session-work-location.js";
import { sessionWorkLocation } from "./support/fixtures.js";

const check = compileSchema(SessionWorkLocationSchema);
const pair = (branch: string) => ({
	repository: "github.com/acme/web",
	branch,
});
const withLocations = (locations: unknown[]) => ({
	...sessionWorkLocation,
	locations,
});

describe("session work location", () => {
	it("accepts the example and ten pairs", () => {
		expect(check(sessionWorkLocation)).toBe(true);
		expect(
			check(withLocations(Array.from({ length: 10 }, (_, i) => pair(`b${i}`)))),
		).toBe(true);
	});

	it.each([
		["no pairs", withLocations([])],
		[
			"eleven pairs",
			withLocations(Array.from({ length: 11 }, (_, i) => pair(`b${i}`))),
		],
		["a repeated pair", withLocations([pair("main"), pair("main")])],
		["a path", withLocations([{ ...pair("main"), path: "/home/ada/web" }])],
		["a commit", withLocations([{ ...pair("main"), commit: "a".repeat(40) }])],
		[
			"a pair without a branch",
			withLocations([{ repository: "github.com/acme/web" }]),
		],
		["a cwd", { ...sessionWorkLocation, cwd: "/home/ada/web" }],
	])("rejects %s", (_, value) => expect(check(value)).toBe(false));
});
