import { compileSchema } from "@harnessforce/test-support/validator";
import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import {
	CalendarDate,
	CommitSha,
	Instant,
	RepositorySlug,
	SemVer,
	Sha256Hex,
	Token,
} from "../src/schemas/common.js";
import { isInstant, isToken } from "../src/values.js";

const one = (schema: unknown) =>
	compileSchema(
		Type.Object({ v: schema as never }, { additionalProperties: false }),
	);

describe("Instant", () => {
	const check = one(Instant);
	it.each([
		"2026-09-26T01:02:03Z",
		"2026-09-26T10:02:03.123+09:00",
	])("accepts %s", (v) => expect(check({ v })).toBe(true));
	it.each([
		"2026-09-26T01:02:03",
		"2026-09-26 01:02:03Z",
		"2026-13-01T00:00:00Z",
		"2026-09-26",
	])("rejects offset-less or invalid %s", (v) =>
		expect(check({ v })).toBe(false));
});

// semantic-conventions.md「値の形」のinstant: offsetのhhは00〜23、mmは00〜59。1677-09-21T00:12:44Zから
// 2262-04-11T23:47:16Zまでの瞬間。
describe("Instant range", () => {
	const check = one(Instant);
	it.each([
		"2026-09-26T01:02:03+23:59",
		"2026-09-26T01:02:03-23:00",
		"1677-09-21T00:12:44Z",
		"2262-04-11T23:47:16Z",
		"2262-04-11T23:47:16.0000000009Z",
	])("accepts %s", (v) => {
		expect(check({ v })).toBe(true);
		expect(isInstant(v)).toBe(true);
	});
	it.each([
		"2026-09-26T01:02:03+24:00",
		"2026-09-26T01:02:03+09:60",
		"2026-09-26T01:02:03-99:99",
		"1676-12-31T23:59:59Z",
		"2263-01-01T00:00:00Z",
		"0001-01-01T00:00:00Z",
		"9999-12-31T23:59:59Z",
	])("rejects %s in the schema and in isInstant", (v) => {
		expect(check({ v })).toBe(false);
		expect(isInstant(v)).toBe(false);
	});
	// JSON Schemaはoffsetを引いた瞬間を比べられないため、境界の年の中の範囲はisInstantが確かめる。
	it.each([
		"1677-09-21T00:12:43Z",
		"1677-09-21T09:12:43+09:00",
		"2262-04-11T23:47:17Z",
		"2262-04-11T23:00:00-01:00",
		"2026-02-30T00:00:00Z",
		"2026-09-26T12:30:60Z",
		"2026-09-26T12:60:00Z",
		"2262-04-11T23:47:16.000000001Z",
	])("rejects %s outside the range or the calendar in isInstant", (v) =>
		expect(isInstant(v)).toBe(false));
	it.each([
		"1677-09-21T09:12:44+09:00",
		"2262-04-12T08:47:16+09:00",
		"2024-02-29T00:00:00Z",
	])("accepts %s in isInstant", (v) => expect(isInstant(v)).toBe(true));
});

// semantic-conventions.md「値の形」のtoken: Unicodeの`White_Space`を含まない。文字数はcode pointで数える。
describe("Token by Unicode White_Space and code points", () => {
	const check = one(Token());
	it.each([
		["NEL (U+0085)", "a\u0085b"],
		["NBSP (U+00A0)", "a\u00a0b"],
		["ideographic space (U+3000)", "a\u3000b"],
		["line separator (U+2028)", "a\u2028b"],
		["vertical tab", "a\u000bb"],
	])("rejects %s", (_, v) => {
		expect(check({ v })).toBe(false);
		expect(isToken(v)).toBe(false);
	});
	it("accepts U+FEFF, which is not White_Space", () => {
		expect(check({ v: "a\ufeffb" })).toBe(true);
		expect(isToken("a\ufeffb")).toBe(true);
	});
	it("counts code points, not UTF-16 code units", () => {
		const emoji = "\u{1F600}";
		expect(check({ v: emoji.repeat(256) })).toBe(true);
		expect(isToken(emoji.repeat(256))).toBe(true);
		expect(check({ v: emoji.repeat(257) })).toBe(false);
		expect(isToken(emoji.repeat(257))).toBe(false);
		expect(isToken("a".repeat(300), 300)).toBe(true);
		expect(isToken("a".repeat(301), 300)).toBe(false);
		expect(isToken("")).toBe(false);
	});
});

describe("scalar formats", () => {
	it("CalendarDate keeps YYYY-MM-DD", () => {
		expect(one(CalendarDate)({ v: "2026-09-26" })).toBe(true);
		expect(one(CalendarDate)({ v: "2026-09-26T00:00:00Z" })).toBe(false);
	});
	it("RepositorySlug is host/owner/name", () => {
		expect(one(RepositorySlug)({ v: "github.com/acme/web" })).toBe(true);
		expect(one(RepositorySlug)({ v: "lambda-script/harnessforce-agent" })).toBe(
			false,
		);
	});
	it("CommitSha accepts SHA-1 and SHA-256 hex", () => {
		expect(one(CommitSha)({ v: "a".repeat(40) })).toBe(true);
		expect(one(CommitSha)({ v: "a".repeat(64) })).toBe(true);
		expect(one(CommitSha)({ v: "main" })).toBe(false);
	});
	it("Sha256Hex is lowercase 64 hex", () => {
		expect(one(Sha256Hex)({ v: "0".repeat(64) })).toBe(true);
		expect(one(Sha256Hex)({ v: "A".repeat(64) })).toBe(false);
	});
	it("SemVer", () => {
		expect(one(SemVer)({ v: "1.2.3" })).toBe(true);
		expect(one(SemVer)({ v: "v1" })).toBe(false);
	});
	it("Token rejects whitespace so no free text can pass", () => {
		expect(one(Token())({ v: "eng-42-login" })).toBe(true);
		expect(one(Token())({ v: "fix the login bug" })).toBe(false);
		expect(one(Token())({ v: "" })).toBe(false);
	});
});
