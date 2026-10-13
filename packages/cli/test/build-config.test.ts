import { describe, expect, it } from "vitest";
import { buildConfigFrom } from "../scripts/build-config.mjs";

describe("CLI build input", () => {
	it.each([
		"https://app.example.test",
		"http://localhost:3000",
	])("records the connection URL %s", (url) =>
		expect(buildConfigFrom({ HARNESSFORCE_BUILD_URL: url })).toEqual({ url }));

	// environments.md「接続先」: 値を与えないbuildの既定の接続先はproductionとする。空文字は与えていないものとして扱う。
	it.each([
		[{}],
		[{ HARNESSFORCE_BUILD_URL: "" }],
	])("defaults to production without a URL: %j", (env) =>
		expect(buildConfigFrom(env)).toEqual({ url: "https://harnessforce.dev" }));

	// 与えた値が許可されない形なら、既定値へ黙って戻さず失敗する。
	it.each([
		[{ HARNESSFORCE_BUILD_URL: "http://app.example.test" }],
		[{ HARNESSFORCE_BUILD_URL: "app.example.test" }],
	])("fails without an allowed URL: %j", (env) =>
		expect(() => buildConfigFrom(env)).toThrow("HARNESSFORCE_BUILD_URL"));
});
