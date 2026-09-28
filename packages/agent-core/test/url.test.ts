import { describe, expect, it } from "vitest";
import { parseAllowedUrl } from "../src/url.js";

describe("parseAllowedUrl", () => {
	it.each([
		"https://app.example.test",
		"https://app.example.test/base/",
		"http://localhost:3000",
		"http://127.0.0.1:8787/ingest",
		"http://[::1]:3000",
	])("accepts %s", (value) =>
		expect(parseAllowedUrl(value)?.href).toBe(new URL(value).href));

	it.each([
		undefined,
		"",
		"app.example.test",
		"http://app.example.test",
		"http://localhost.example.test",
		"ftp://app.example.test",
		"file:///etc/passwd",
	])("rejects %j", (value) => expect(parseAllowedUrl(value)).toBeUndefined());
});
