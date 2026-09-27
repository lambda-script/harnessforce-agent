import type { SessionImport } from "@harnessforce/semconv";
import { describe, expect, it } from "vitest";
import { sendSessions } from "../../src/import/send.js";
import type { Fetch } from "../../src/init/http.js";

const ENDPOINT = new URL("https://ingest.example.test/base");
const session = (id: string): SessionImport => ({
	agent: "claude_code",
	source: "import",
	session_id: id,
	repository: "github.com/acme/web",
	started_at: "2026-09-20T00:00:00.000Z",
	ended_at: "2026-09-20T01:00:00.000Z",
	model: "claude-a",
	input_tokens: 1,
	output_tokens: 1,
	tool_calls: [],
	parser_version: "1.0.0",
});
const sessions = (count: number) =>
	Array.from({ length: count }, (_, i) => session(`s${i}`));

const json = (
	status: number,
	body?: unknown,
	headers: Record<string, string> = {},
) =>
	new Response(body === undefined ? null : JSON.stringify(body), {
		status,
		headers,
	});
const ok = (rejected: { index: number; reason: string }[], accepted: number) =>
	json(200, { accepted, rejected });

// 要求ごとに次の応答を返す。bodyはsession IDの配列として記録する。
function server(...replies: (Response | Error)[]) {
	const bodies: string[][] = [];
	const requests: { url: string; init: RequestInit }[] = [];
	const fetch: Fetch = async (url, init) => {
		requests.push({ url: url.href, init });
		bodies.push(
			(JSON.parse(String(init.body)) as SessionImport[]).map(
				(s) => s.session_id,
			),
		);
		const batchSize = bodies.at(-1)?.length ?? 0;
		const reply = replies.shift() ?? ok([], batchSize);
		if (reply instanceof Error) throw reply;
		return reply;
	};
	return { fetch, bodies, requests };
}

function run(fetch: Fetch, all: SessionImport[]) {
	const recorded: string[][] = [];
	const sleeps: number[] = [];
	const result = sendSessions({
		endpoint: ENDPOINT,
		ingestKey: "hf_ik_ws1_user",
		sessions: all,
		fetch,
		sleep: async (ms) => {
			sleeps.push(ms);
		},
		record: async (ids) => {
			recorded.push([...ids]);
		},
	});
	return { result, recorded, sleeps };
}

describe("sendSessions", () => {
	it("posts 100 sessions per request with the user ingest key and records each batch", async () => {
		const { fetch, bodies, requests } = server();
		const { result, recorded } = run(fetch, sessions(250));
		expect(await result).toEqual({ kind: "done", imported: 250, invalid: 0 });
		expect(bodies.map((b) => b.length)).toEqual([100, 100, 50]);
		expect(recorded.map((r) => r.length)).toEqual([100, 100, 50]);
		expect(requests[0]?.url).toBe(
			"https://ingest.example.test/base/v1/imports/sessions",
		);
		expect(requests[0]?.init).toMatchObject({
			method: "POST",
			headers: {
				authorization: "Bearer hf_ik_ws1_user",
				"content-type": "application/json",
			},
			redirect: "manual",
		});
		expect(requests[0]?.init.signal).toBeInstanceOf(AbortSignal);
	});

	it("sends nothing when there is nothing to send", async () => {
		const { fetch, requests } = server();
		expect(await run(fetch, []).result).toEqual({
			kind: "done",
			imported: 0,
			invalid: 0,
		});
		expect(requests).toEqual([]);
	});

	it("records schema rejections as sent and counts them", async () => {
		const { fetch } = server(ok([{ index: 1, reason: "schema: model" }], 2));
		const { result, recorded } = run(fetch, sessions(3));
		expect(await result).toEqual({ kind: "done", imported: 2, invalid: 1 });
		expect(recorded).toEqual([["s0", "s1", "s2"]]);
	});

	// correlation.md「session import」: 取り込んだ件数は`accepted`の合計とする。
	it("counts imported sessions from accepted", async () => {
		const { fetch } = server(ok([], 60), ok([], 1));
		const { result } = run(fetch, sessions(101));
		expect(await result).toEqual({ kind: "done", imported: 61, invalid: 0 });
	});

	it.each([
		["monthly_event_limit"],
		["workspace_read_only"],
	])("stops on %s without recording those sessions", async (reason) => {
		const { fetch, bodies } = server(
			ok([], 100),
			ok(
				[
					{ index: 0, reason },
					{ index: 2, reason: "bad" },
				],
				98,
			),
		);
		const { result, recorded } = run(fetch, sessions(250));
		// 取り込めなかった1件と、送らなかった3回目の50件。
		expect(await result).toEqual({ kind: "limited", reason, notImported: 51 });
		expect(bodies).toHaveLength(2);
		expect(recorded[1]).toEqual(
			sessions(200)
				.slice(101)
				.map((s) => s.session_id),
		);
	});

	it("waits Retry-After and resends the same request on 429 and 503", async () => {
		const { fetch, bodies } = server(
			json(429, undefined, { "retry-after": "7" }),
			json(503),
			json(429, undefined, { "retry-after": "120" }),
			ok([], 2),
		);
		const { result, sleeps } = run(fetch, sessions(2));
		expect(await result).toEqual({ kind: "done", imported: 2, invalid: 0 });
		expect(sleeps).toEqual([7000, 60_000, 60_000]);
		expect(new Set(bodies.map((b) => b.join()))).toEqual(new Set(["s0,s1"]));
	});

	it("fails after three resends without recording the batch, keeping earlier batches", async () => {
		const busy = () => json(503, undefined, { "retry-after": "1" });
		const { fetch, bodies } = server(
			ok([], 100),
			busy(),
			busy(),
			busy(),
			busy(),
		);
		const { result, recorded, sleeps } = run(fetch, sessions(150));
		expect(await result).toEqual({ kind: "failed" });
		expect(bodies).toHaveLength(5);
		expect(sleeps).toHaveLength(3);
		expect(recorded).toHaveLength(1);
	});

	it("is unauthorized on 401", async () => {
		const { fetch } = server(json(401));
		const { result, recorded } = run(fetch, sessions(1));
		expect(await result).toEqual({ kind: "unauthorized" });
		expect(recorded).toEqual([]);
	});

	it.each([
		["400", json(400)],
		["413", json(413)],
		["500", json(500)],
		["a redirect", json(307, undefined, { location: "https://evil.test/" })],
		["a body that is not a result", json(200, { ok: true })],
		["a rejected index outside the batch", ok([{ index: 5, reason: "x" }], 0)],
		// ingest-api.md: 200の本文は`{accepted, rejected[]}`。
		["a result without accepted", json(200, { rejected: [] })],
		[
			"an accepted that is not a count",
			json(200, { accepted: "1", rejected: [] }),
		],
		["a negative accepted", json(200, { accepted: -1, rejected: [] })],
		["a connection failure", new TypeError("fetch failed")],
		["a timeout", new DOMException("timeout", "TimeoutError")],
	])("fails on %s without resending", async (_, reply) => {
		const { fetch, bodies } = server(reply);
		const { result, recorded } = run(fetch, sessions(1));
		expect(await result).toEqual({ kind: "failed" });
		expect(bodies).toHaveLength(1);
		expect(recorded).toEqual([]);
	});
});
