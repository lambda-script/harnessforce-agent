import { describe, expect, it } from "vitest";
import { REDACTION_KINDS, REDACTION_RULES, redactText } from "../src/index.js";

// privacy-and-retention.md「Redaction」: semconvの0.1.0が公開された後は、本体のredactionとharnessforce tune publishの
// 検査がこの定義を使う。本体のpackages/core（公開前の正本）の定義と1文字も違わないことを固定する。
const CORE_DEFINITIONS = [
	{
		kind: "private_key",
		source:
			"-----BEGIN [A-Z ]*PRIVATE KEY-----(?:(?!-----BEGIN )[\\s\\S])*?-----END [A-Z ]*PRIVATE KEY-----",
		flags: "g",
	},
	{
		kind: "connection_string",
		source:
			"(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\\/\\/[^\\s:/@]+:[^\\s/@]+@[^\\s\"'<>]+",
		flags: "gi",
	},
	{
		kind: "jwt",
		source:
			"(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}",
		flags: "g",
	},
	{
		kind: "api_key",
		source:
			"(?<![A-Za-z0-9])(?:sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}|(?:AKIA|ASIA)[0-9A-Z]{16}|hf_(?:ik|at|rt)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[A-Za-z0-9_-]{43})",
		flags: "g",
	},
	{
		kind: "bearer_token",
		source: "\\bBearer\\s+[A-Za-z0-9._~+/-]{16,}=*",
		flags: "g",
	},
	{
		kind: "email",
		source:
			"(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}",
		flags: "g",
	},
	{
		kind: "phone",
		source:
			"(?<![\\w+])\\+[1-9]\\d{7,14}(?!\\d)|(?<![\\w-])0\\d{1,4}-\\d{1,4}-\\d{4}(?![\\w-])",
		flags: "g",
	},
];

describe("redaction definitions", () => {
	it("lists the kinds of privacy-and-retention.md in the order they are applied", () =>
		expect(REDACTION_KINDS).toEqual([
			"private_key",
			"connection_string",
			"jwt",
			"api_key",
			"bearer_token",
			"email",
			"phone",
		]));

	it("matches the regular expressions of the Harnessforce core exactly", () =>
		expect(
			REDACTION_RULES.map(({ kind, pattern }) => ({
				kind,
				source: pattern.source,
				flags: pattern.flags,
			})),
		).toEqual(CORE_DEFINITIONS));
});

// fixtureに実在の認証情報を置かない。形だけが合う値を組み立てる。
describe("redactText", () => {
	it.each([
		["an Anthropic key", `sk-ant-api03-${"a".repeat(40)}`],
		["an OpenAI project key", `sk-proj-${"b".repeat(40)}`],
		["an OpenAI key", `sk-${"c".repeat(48)}`],
		["a Google API key", `AIza${"d".repeat(35)}`],
		["a GitHub token", `ghp_${"0".repeat(36)}`],
		["a GitHub app token", `ghs_${"1".repeat(36)}`],
		["a fine-grained GitHub token", `github_pat_${"2".repeat(40)}`],
		["an AWS access key id", `AKIA${"A".repeat(16)}`],
		["an AWS temporary access key id", `ASIA${"B".repeat(16)}`],
		[
			"a Harnessforce ingest key",
			`hf_ik_01990000-0000-7000-8000-000000000001_${"A".repeat(43)}`,
		],
		[
			"a Harnessforce access token",
			`hf_at_01990000-0000-7000-8000-000000000001_${"A".repeat(43)}`,
		],
		[
			"a Harnessforce refresh token",
			`hf_rt_01990000-0000-7000-8000-000000000001_${"A".repeat(43)}`,
		],
	])("masks %s", (_label, secret) =>
		expect(redactText(`token=${secret};`)).toEqual({
			text: "token=[REDACTED:api_key];",
			count: 1,
		}));

	it("masks a key that follows an environment variable name", () =>
		expect(
			redactText(
				`KEY_hf_ik_01990000-0000-7000-8000-000000000001_${"A".repeat(43)}`,
			),
		).toEqual({ text: "KEY_[REDACTED:api_key]", count: 1 }));

	it("masks a private key block", () =>
		expect(
			redactText(
				"key: -----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----",
			),
		).toEqual({ text: "key: [REDACTED:private_key]", count: 1 }));

	it("masks a connection string once without also counting its host as an email", () =>
		expect(
			redactText("DATABASE_URL=postgres://app:pa55word@db.internal:5432/main"),
		).toEqual({ text: "DATABASE_URL=[REDACTED:connection_string]", count: 1 }));

	it("masks a JWT", () =>
		expect(
			redactText(
				"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop",
			),
		).toEqual({ text: "[REDACTED:jwt]", count: 1 }));

	it("counts a key inside a bearer header once, as an api key", () =>
		expect(redactText(`Bearer sk-ant-api03-${"a".repeat(40)}`)).toEqual({
			text: "Bearer [REDACTED:api_key]",
			count: 1,
		}));

	it("masks a bearer token but keeps the header name", () =>
		expect(
			redactText("Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345"),
		).toEqual({ text: "Authorization: [REDACTED:bearer_token]", count: 1 }));

	it("masks email addresses and E.164 and Japanese phone numbers", () =>
		expect(
			redactText(
				"mail dev@example.com or call +819012345678 / 03-1234-5678 / 090-1234-5678",
			),
		).toEqual({
			text: "mail [REDACTED:email] or call [REDACTED:phone] / [REDACTED:phone] / [REDACTED:phone]",
			count: 4,
		}));

	it("can leave phone numbers in names while masking other kinds", () =>
		expect(
			redactText("dev@example.com 03-1234-5678", { skipPhone: true }),
		).toEqual({ text: "[REDACTED:email] 03-1234-5678", count: 1 }));

	it.each([
		"session 01990000-0000-7000-8000-000000000001",
		"trace 5b8efff798038103d269b633813fc60c",
		"2026-09-26T12:00:00Z",
		"task-runner sk-short",
		"https://github.com/lambda-script/harnessforce/pull/12",
	])("leaves %s untouched", (text) =>
		expect(redactText(text)).toEqual({ text, count: 0 }));

	// 送信元が決める長い文字列でも、走査が長さに対して線形であること。
	it.each([
		["an email-like run without @", "a".repeat(200_000)],
		["a dotted run without ://", "a.".repeat(100_000)],
		[
			"private key headers without an end",
			"-----BEGIN RSA PRIVATE KEY-----".repeat(10_000),
		],
		["JWT headers without a payload", "eyJ-".repeat(50_000)],
	])("scans %s in linear time", (_label, text) => {
		const startedAt = performance.now();
		redactText(text);
		expect(performance.now() - startedAt).toBeLessThan(500);
	});

	it("keeps working across calls with the shared global patterns", () => {
		expect(redactText("a@example.com").count).toBe(1);
		expect(redactText("a@example.com").count).toBe(1);
	});
});
