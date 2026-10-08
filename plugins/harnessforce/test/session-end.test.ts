import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runHook } from "../src/hook.js";
import {
	type Harness,
	harness,
	isUsageSummary,
	pluginData,
	REPO,
	scratchpad,
} from "./support.js";

const run = (h: Harness, event: string, input: Record<string, unknown> = {}) =>
	runHook(
		event,
		JSON.stringify({ session_id: "s-1", cwd: REPO.cwd, ...input }),
		h.deps,
	);

// 時計を進め、hookのprocessがその時刻に始まったことにする。
function at(h: Harness, instant: string): Harness {
	h.deps.now = () => new Date(instant);
	h.deps.processStartMs = Date.parse(instant);
	return h;
}

const NO_CALLS = {
	skills: { items: [], other: { calls: 0, failures: 0 } },
	commands: { items: [], other: { calls: 0 } },
	subagents: { items: [], other: { calls: 0, failures: 0 } },
	mcp_servers: { items: [], other: { calls: 0, failures: 0 } },
	permission_requests: 0,
	compactions: { auto: 0, manual: 0 },
};

// managed settingsのfileのWorkspace用のkeyで始めたsession。
async function startedSession(input: Record<string, unknown> = {}) {
	const data = pluginData();
	await run(
		at(harness({ env: { CLAUDE_PLUGIN_DATA: data } }), "2026-09-26T00:00:00Z"),
		"session-start",
		{ source: "startup", ...input },
	);
	return data;
}

describe("session usage summary at SessionEnd", () => {
	it("sends the summary of the session's record with the workspace key", async () => {
		const data = await startedSession();
		await run(
			at(
				harness({ env: { CLAUDE_PLUGIN_DATA: data } }),
				"2026-09-26T00:01:00Z",
			),
			"user-prompt-submit",
			{ prompt_id: "p-1" },
		);
		const end = at(
			harness({ env: { CLAUDE_PLUGIN_DATA: data } }),
			"2026-09-26T00:05:00Z",
		);
		await run(end, "session-end", { reason: "prompt_input_exit" });
		expect(end.requests.map((r) => r.url)).toEqual([
			"https://ingest.example.test/v1/session-usage",
		]);
		expect(end.requests[0]?.init).toMatchObject({
			method: "POST",
			headers: {
				authorization: "Bearer hf_ik_ws1_secret",
				"content-type": "application/json",
			},
			redirect: "error",
		});
		const summary = {
			agent: "claude_code",
			session_id: "s-1",
			first_prompt_id: "p-1",
			started_at: "2026-09-26T00:00:00.000Z",
			last_event_at: "2026-09-26T00:01:00.000Z",
			collector_version: "0.1.0",
			...NO_CALLS,
		};
		expect(end.bodies()).toEqual([[summary]]);
		expect(isUsageSummary(end.bodies()[0]?.[0])).toBe(true);
		expect(end.out()).toBe("");
		expect(end.err()).toBe("");
	});

	// correlation.md「要約の作り方」: どの呼び出しも無かったことを、要約の無いsessionと区別する。
	it("sends a summary for a session whose record has only the start", async () => {
		const data = await startedSession();
		const end = at(
			harness({ env: { CLAUDE_PLUGIN_DATA: data } }),
			"2026-09-26T00:05:00Z",
		);
		await run(end, "session-end");
		expect(end.bodies()).toEqual([
			[
				{
					agent: "claude_code",
					session_id: "s-1",
					started_at: "2026-09-26T00:00:00.000Z",
					last_event_at: "2026-09-26T00:00:00.000Z",
					collector_version: "0.1.0",
					...NO_CALLS,
				},
			],
		]);
	});

	it("records the session from a resume that has no record yet", async () => {
		const data = pluginData();
		const resumed = at(
			harness({ env: { CLAUDE_PLUGIN_DATA: data } }),
			"2026-09-26T00:00:00Z",
		);
		await run(resumed, "session-start", { source: "resume" });
		expect(resumed.requests).toEqual([]);
		const end = harness({ env: { CLAUDE_PLUGIN_DATA: data } });
		await run(end, "session-end");
		expect(end.bodiesTo("/v1/session-usage")).toHaveLength(1);
	});

	// SessionEndの1.5秒の予算にkeychainの読み出しを収められないため、利用者用のkeyでは次のsessionの開始で送る。
	it("sends nothing and does not read the keychain with a user key", async () => {
		const data = pluginData();
		const userKeyOptions = {
			managed: null,
			env: {
				CLAUDE_PLUGIN_DATA: data,
				HARNESSFORCE_ENDPOINT: "https://ingest.example.test",
				HARNESSFORCE_WORKSPACE_ID: "ws1",
			},
			userKey: { kind: "found", key: "hf_ik_ws1_user" },
		} as const;
		await run(harness(userKeyOptions), "session-start");
		const end = harness(userKeyOptions);
		await run(end, "session-end");
		expect(end.requests).toEqual([]);
		expect(end.userKeyReads()).toBe(0);
		expect(end.err()).toBe("");
	});

	it("sends nothing once the session is marked unauthorized", async () => {
		const data = pluginData();
		const pad = scratchpad();
		await run(
			harness({ status: 401, env: { CLAUDE_PLUGIN_DATA: data } }),
			"session-start",
			{ scratchpad_dir: pad },
		);
		const end = harness({ env: { CLAUDE_PLUGIN_DATA: data } });
		await run(end, "session-end", { scratchpad_dir: pad });
		expect(end.requests).toEqual([]);
	});

	it("sends nothing when the key belongs to another Workspace than the record", async () => {
		const data = await startedSession();
		const end = harness({
			env: { CLAUDE_PLUGIN_DATA: data },
			managed: { HARNESSFORCE_INGEST_KEY: "hf_ik_ws2_secret" },
		});
		await run(end, "session-end");
		expect(end.requests).toEqual([]);
	});

	it("records nothing when SessionStart had no valid destination", async () => {
		const data = pluginData();
		await run(
			harness({
				env: { CLAUDE_PLUGIN_DATA: data },
				managed: { HARNESSFORCE_ENDPOINT: "http://ingest.example.test" },
			}),
			"session-start",
		);
		const end = harness({ env: { CLAUDE_PLUGIN_DATA: data } });
		await run(end, "session-end");
		expect(end.requests).toEqual([]);
	});

	it.each([
		["CLAUDE_PLUGIN_DATA is relative", { CLAUDE_PLUGIN_DATA: "data" }, "s-1"],
		["CLAUDE_PLUGIN_DATA is missing", {}, "s-1"],
		["the session id has characters outside [A-Za-z0-9_-]", undefined, "s.1"],
	])("records and sends nothing when %s", async (_, env, sessionId) => {
		const data = pluginData();
		const options = { env: env ?? { CLAUDE_PLUGIN_DATA: data } };
		await run(harness(options), "session-start", { session_id: sessionId });
		const end = harness(options);
		await run(end, "session-end", { session_id: sessionId });
		expect(end.requests).toEqual([]);
		expect(readdirSync(data)).toEqual([]);
	});

	it("gives up the send when the 1 second budget from the process start runs out", async () => {
		const data = await startedSession();
		const end = at(
			harness({ env: { CLAUDE_PLUGIN_DATA: data }, hang: true }),
			"2026-09-26T00:05:00Z",
		);
		// processの開始から900ms経っているため、送信に残るのは100msである。
		end.deps.processStartMs -= 900;
		const began = Date.now();
		await run(end, "session-end");
		expect(Date.now() - began).toBeLessThan(900);
		expect(end.requests).toHaveLength(1);
		expect(end.out()).toBe("");
		expect(end.err()).toBe(
			"harnessforce: session usage failed (TimeoutError)\n",
		);
	});

	it("does not send once the budget is used up", async () => {
		const data = await startedSession();
		const end = at(
			harness({ env: { CLAUDE_PLUGIN_DATA: data } }),
			"2026-09-26T00:05:00Z",
		);
		end.deps.processStartMs -= 1000;
		await run(end, "session-end");
		expect(end.requests).toEqual([]);
		expect(end.err()).toBe(
			"harnessforce: session usage failed (TimeoutError)\n",
		);
	});

	it.each([401, 503])("reports HTTP %i on stderr only", async (status) => {
		const data = await startedSession();
		const end = harness({ env: { CLAUDE_PLUGIN_DATA: data }, status });
		await run(end, "session-end");
		expect(end.out()).toBe("");
		expect(end.err()).toBe(
			`harnessforce: session usage failed (HTTP ${status})\n`,
		);
	});

	it("keeps the record under CLAUDE_PLUGIN_DATA/usage", async () => {
		const data = await startedSession();
		expect(existsSync(`${data}/usage/s-1.jsonl`)).toBe(true);
		expect(existsSync(`${data}/usage/s-1.json`)).toBe(true);
	});
});
