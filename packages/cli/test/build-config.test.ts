import { describe, expect, it } from "vitest";
import { buildConfigFrom } from "../scripts/build-config.mjs";

describe("CLI build input", () => {
	it.each([
		"https://app.example.test",
		"http://localhost:3000",
	])("records the connection URL %s", (url) =>
		expect(buildConfigFrom({ HARNESSFORCE_BUILD_URL: url })).toEqual({ url }));

	// correlation.md「接続先」: 値を与えないbuildは失敗し、既定値で補わない。
	it.each([
		[{}],
		[{ HARNESSFORCE_BUILD_URL: "" }],
		[{ HARNESSFORCE_BUILD_URL: "http://app.example.test" }],
		[{ HARNESSFORCE_BUILD_URL: "app.example.test" }],
	])("fails without an allowed URL: %j", (env) =>
		expect(() => buildConfigFrom(env)).toThrow("HARNESSFORCE_BUILD_URL"));
});
