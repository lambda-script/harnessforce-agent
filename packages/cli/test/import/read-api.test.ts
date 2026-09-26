import { describe, expect, it } from "vitest";
import {
	fetchSessionImportDays,
	listConnectedRepositories,
} from "../../src/import/read-api.js";
import type { Fetch } from "../../src/init/http.js";

const BASE = new URL("https://app.example.test/base/");
const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

// URLごとの応答を返し、受けた要求を記録する。
function fakeFetch(reply: (url: URL) => Response | Promise<Response>) {
	const requests: { url: string; init: RequestInit }[] = [];
	const fetch: Fetch = async (url, init) => {
		requests.push({ url: url.href, init });
		return reply(url);
	};
	return { fetch, requests };
}

const page = (repositories: string[], next: string | null) =>
	json(200, {
		data: repositories.map((repository) => ({ repository })),
		next_cursor: next,
	});

describe("listConnectedRepositories", () => {
	it("follows the cursor through every page with the api token", async () => {
		const { fetch, requests } = fakeFetch((url) =>
			url.searchParams.get("cursor") === "c2"
				? page(["github.com/acme/api"], null)
				: page(["github.com/acme/web"], "c2"),
		);
		expect(await listConnectedRepositories(BASE, "hf_at_token", fetch)).toEqual(
			{
				kind: "ok",
				value: new Set(["github.com/acme/web", "github.com/acme/api"]),
			},
		);
		expect(requests.map((r) => r.url)).toEqual([
			"https://app.example.test/base/api/v1/repositories",
			"https://app.example.test/base/api/v1/repositories?cursor=c2",
		]);
		expect(requests[0]?.init).toMatchObject({
			headers: { authorization: "Bearer hf_at_token" },
			redirect: "manual",
		});
		expect(requests[0]?.init.signal).toBeInstanceOf(AbortSignal);
	});

	it("is unauthorized on 401 from any page", async () => {
		const { fetch } = fakeFetch((url) =>
			url.searchParams.has("cursor") ? json(401, {}) : page([], "c2"),
		);
		expect(await listConnectedRepositories(BASE, "t", fetch)).toEqual({
			kind: "unauthorized",
		});
	});

	it.each([
		[
			"a 500 on a later page",
			(url: URL) =>
				url.searchParams.has("cursor") ? json(500, {}) : page([], "c2"),
		],
		[
			"a redirect",
			() =>
				new Response(null, {
					status: 302,
					headers: { location: "https://evil.test/" },
				}),
		],
		["a body that is not a page", () => json(200, { repositories: [] })],
		[
			"a repository that is not a string",
			() => json(200, { data: [{ repository: 1 }], next_cursor: null }),
		],
		["a cursor that repeats", () => page([], "same")],
		[
			"a connection failure",
			() => Promise.reject(new TypeError("fetch failed")),
		],
		[
			"a timeout",
			() => Promise.reject(new DOMException("timeout", "TimeoutError")),
		],
	])("fails on %s", async (_, reply) => {
		expect(
			await listConnectedRepositories(BASE, "t", fakeFetch(reply).fetch),
		).toEqual({
			kind: "failed",
		});
	});
});

describe("fetchSessionImportDays", () => {
	it("reads session_import_days of the workspace", async () => {
		const { fetch, requests } = fakeFetch(() =>
			json(200, { session_import_days: 14 }),
		);
		expect(await fetchSessionImportDays(BASE, "hf_at_token", fetch)).toEqual({
			kind: "ok",
			value: 14,
		});
		expect(requests[0]?.url).toBe(
			"https://app.example.test/base/api/v1/workspace",
		);
		expect(requests[0]?.init).toMatchObject({
			headers: { authorization: "Bearer hf_at_token" },
		});
	});

	it("is unauthorized on 401", async () =>
		expect(
			await fetchSessionImportDays(
				BASE,
				"t",
				fakeFetch(() => json(401, {})).fetch,
			),
		).toEqual({
			kind: "unauthorized",
		}));

	it.each([
		[0],
		[1.5],
		["30"],
		[null],
	])("fails on session_import_days %j", async (days) =>
		expect(
			await fetchSessionImportDays(
				BASE,
				"t",
				fakeFetch(() => json(200, { session_import_days: days })).fetch,
			),
		).toEqual({ kind: "failed" }));
});
