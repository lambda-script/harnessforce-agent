import { describe, expect, it } from "vitest";
import { resolveIssue } from "../../src/run/issues.js";
import { issueBody, startReadApi } from "./read-api.js";

const TOKEN = "hf_at_token";
const realFetch = (url: URL, init: RequestInit) => fetch(url, init);

describe("resolveIssue", () => {
	it("resolves with the ApiToken and the identifier as one path segment", async () => {
		const api = await startReadApi({
			issue: (id) =>
				id === "#45"
					? { status: 200, body: issueBody("#45") }
					: { status: 404 },
			basePath: "/app",
		});
		expect(
			await resolveIssue(new URL(api.base), "#45", TOKEN, realFetch),
		).toEqual({ kind: "resolved" });
		expect(api.requests).toHaveLength(1);
		expect(api.requests[0]?.url).toBe("/app/api/v1/issues/%2345");
		expect(api.requests[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
	});

	it("lists the first ten candidates of the first page after a 404", async () => {
		const data = Array.from({ length: 12 }, (_, i) => issueBody(`ENG-${i}`));
		const api = await startReadApi({
			list: (query) =>
				query === "ENG 4"
					? { status: 200, body: { items: data, next_cursor: "c2" } }
					: { status: 500 },
		});
		const r = await resolveIssue(new URL(api.base), "ENG 4", TOKEN, realFetch);
		expect(r).toEqual({ kind: "candidates", candidates: data.slice(0, 10) });
		expect(api.requests.map((q) => q.url)).toEqual([
			"/api/v1/issues/ENG%204",
			"/api/v1/issues?query=ENG+4",
		]);
		expect(api.requests[1]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
	});

	it("returns no candidates when the list is empty", async () => {
		const api = await startReadApi();
		expect(
			await resolveIssue(new URL(api.base), "ENG-1", TOKEN, realFetch),
		).toEqual({ kind: "candidates", candidates: [] });
	});

	it.each([
		["resolution", { issue: () => ({ status: 401 }) }],
		["candidates", { list: () => ({ status: 401 }) }],
	])("reports a 401 on %s as unauthorized", async (_, options) => {
		const api = await startReadApi(options);
		expect(
			await resolveIssue(new URL(api.base), "ENG-1", TOKEN, realFetch),
		).toEqual({ kind: "unauthorized" });
	});

	it.each([
		500, 403, 302,
	])("does not fetch candidates when resolution answers %i", async (status) => {
		const api = await startReadApi({ issue: () => ({ status }) });
		expect(
			await resolveIssue(new URL(api.base), "ENG-1", TOKEN, realFetch),
		).toEqual({ kind: "failed" });
		expect(api.requests).toHaveLength(1);
	});

	it("fails without candidates when the connection fails", async () => {
		const failing = async () => {
			throw new TypeError("fetch failed");
		};
		expect(
			await resolveIssue(
				new URL("https://unreachable.test"),
				"ENG-1",
				TOKEN,
				failing,
			),
		).toEqual({ kind: "failed" });
	});

	it("gives up on a request after the time limit", async () => {
		const api = await startReadApi({
			issue: () => ({ status: 200, body: issueBody("ENG-1"), delayMs: 500 }),
		});
		expect(
			await resolveIssue(new URL(api.base), "ENG-1", TOKEN, realFetch, 50),
		).toEqual({ kind: "failed" });
	});

	it.each([
		["a non-200 status", { status: 503 }],
		["a body without items", { status: 200, body: { next_cursor: null } }],
		[
			"an item without an identifier",
			{ status: 200, body: { items: [{ title: "t" }], next_cursor: null } },
		],
		// read-api.md: 一覧の要素は少なくとも`identifier`と`title`を持つ。
		[
			"an item without a title",
			{
				status: 200,
				body: { items: [{ identifier: "ENG-1" }], next_cursor: null },
			},
		],
		// read-api.md「共通の約束」: 一覧の応答は`{"items": [...], "next_cursor": <文字列またはnull>}`。
		["a body without next_cursor", { status: 200, body: { items: [] } }],
		[
			"a next_cursor that is not a string or null",
			{ status: 200, body: { items: [], next_cursor: 1 } },
		],
		["a body that is not JSON", { status: 200 }],
	])("fails when the candidate list has %s", async (_, reply) => {
		const api = await startReadApi({ list: () => reply as never });
		expect(
			await resolveIssue(new URL(api.base), "ENG-1", TOKEN, realFetch),
		).toEqual({ kind: "failed" });
	});

	it.each([
		".",
		"..",
	])("lists candidates for %j without a path that the URL parser would collapse", async (identifier) => {
		const api = await startReadApi({ issue: () => ({ status: 200 }) });
		expect(
			await resolveIssue(new URL(api.base), identifier, TOKEN, realFetch),
		).toEqual({ kind: "candidates", candidates: [] });
		expect(api.requests.map((q) => q.url)).toEqual([
			`/api/v1/issues?query=${identifier}`,
		]);
	});
});
