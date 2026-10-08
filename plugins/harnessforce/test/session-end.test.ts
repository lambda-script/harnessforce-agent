import { existsSync, readdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
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

// 記録の最後の変更から11分後に始まる、同じ端末の別のsession。
async function nextSessionStart(data: string) {
	const idle = Date.parse("2026-09-26T00:05:00Z") / 1000;
	utimesSync(join(data, "usage/s-1.jsonl"), idle, idle);
	const next = at(
		harness({ env: { CLAUDE_PLUGIN_DATA: data } }),
		"2026-09-26T00:16:00Z",
	);
	await run(next, "session-start", { session_id: "s-2", source: "startup" });
	return next;
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

	// correlation.md「要約の作り方」: started_atは最も早い行、first_prompt_idはprompt IDを持つ最も早い行で決める。
	it("takes the times and the first prompt from the earliest lines, not the file order", async () => {
		const data = await startedSession();
		const prompt = (instant: string, promptId: string) =>
			run(
				at(harness({ env: { CLAUDE_PLUGIN_DATA: data } }), instant),
				"user-prompt-submit",
				{ prompt_id: promptId },
			);
		await prompt("2026-09-26T00:03:00Z", "p-late");
		await prompt("2026-09-25T23:58:00Z", "p-early");
		const end = harness({ env: { CLAUDE_PLUGIN_DATA: data } });
		await run(end, "session-end");
		expect(end.bodiesTo("/v1/session-usage")[0]?.[0]).toMatchObject({
			first_prompt_id: "p-early",
			started_at: "2026-09-25T23:58:00.000Z",
			last_event_at: "2026-09-26T00:03:00.000Z",
		});
	});

	// 2xxを受けたら送った長さを書き、次のsessionの開始で送り直さない。
	it("is not sent again from the next session start after a 2xx", async () => {
		const data = await startedSession();
		await run(
			at(
				harness({ env: { CLAUDE_PLUGIN_DATA: data } }),
				"2026-09-26T00:05:00Z",
			),
			"session-end",
		);
		const next = await nextSessionStart(data);
		expect(next.bodiesTo("/v1/session-usage")).toEqual([]);
	});

	it.each([
		["a failed send", { status: 503 }, 0],
		["a send cut off by the budget", {}, 1000],
	])("is sent from the next session start after %s", async (_, options, usedMs) => {
		const data = await startedSession();
		const end = at(
			harness({ ...options, env: { CLAUDE_PLUGIN_DATA: data } }),
			"2026-09-26T00:05:00Z",
		);
		end.deps.processStartMs -= usedMs;
		await run(end, "session-end");
		const next = await nextSessionStart(data);
		expect(next.bodiesTo("/v1/session-usage")).toEqual([
			[expect.objectContaining({ session_id: "s-1" })],
		]);
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
		["CLAUDE_PLUGIN_DATA is relative", { CLAUDE_PLUGIN_DATA: "data" }],
		["CLAUDE_PLUGIN_DATA is missing", {}],
	])("sends nothing when %s", async (_, env) => {
		await run(harness({ env }), "session-start");
		const end = harness({ env });
		await run(end, "session-end");
		expect(end.requests).toEqual([]);
	});

	// fileの名前をCLAUDE_PLUGIN_DATAの外へ向けないため。
	it("records and sends nothing for a session id with characters outside [A-Za-z0-9_-]", async () => {
		const data = pluginData();
		const options = { env: { CLAUDE_PLUGIN_DATA: data } };
		await run(harness(options), "session-start", { session_id: "s.1" });
		const end = harness(options);
		await run(end, "session-end", { session_id: "s.1" });
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
