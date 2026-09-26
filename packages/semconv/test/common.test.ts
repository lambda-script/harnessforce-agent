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
import { compile } from "./support/validator.js";

const one = (schema: unknown) =>
	compile(Type.Object({ v: schema as never }, { additionalProperties: false }));

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
