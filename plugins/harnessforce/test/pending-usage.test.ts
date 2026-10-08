import { existsSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runHook } from "../src/hook.js";
import {
	type Harness,
	harness,
	pluginData,
	REPO,
	scratchpad,
	sessionContextLine,
} from "./support.js";

const T0 = Date.parse("2026-09-26T00:00:00Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const WORKSPACE_KEY_REVOKED =
	"組織の送信キーが失効しています。Workspaceの管理者に連絡してください";

type Options = Parameters<typeof harness>[0];

function at(h: Harness, ms: number): Harness {
	h.deps.now = () => new Date(ms);
	h.deps.processStartMs = ms;
	return h;
}

const run = (
	h: Harness,
	event: string,
	sessionId: string,
	input: Record<string, unknown> = {},
) =>
	runHook(
		event,
		JSON.stringify({ session_id: sessionId, cwd: REPO.cwd, ...input }),
		h.deps,
	);

// 記録のfileの最後の変更の時刻を、testの時計に合わせる。
const touch = (data: string, sessionId: string, ms: number) =>
	utimesSync(join(data, `usage/${sessionId}.jsonl`), ms / 1000, ms / 1000);

// SessionEndで送らずに終わったsession（記録の最後の変更はchangedMs）。
async function unsentSession(
	data: string,
	sessionId: string,
	changedMs: number,
	options: Options = {},
) {
	await run(
		at(
			harness({
				...options,
				env: { ...options?.env, CLAUDE_PLUGIN_DATA: data },
			}),
			changedMs,
		),
		"session-start",
		sessionId,
	);
	touch(data, sessionId, changedMs);
}

async function startAt(
	data: string,
	ms: number,
	options: Options = {},
	input: Record<string, unknown> = {},
) {
	const h = at(
		harness({ ...options, env: { ...options?.env, CLAUDE_PLUGIN_DATA: data } }),
		ms,
	);
	await run(h, "session-start", "current", input);
	return h;
}

const sentSessions = (h: Harness) =>
	h
		.bodiesTo("/v1/session-usage")
		.map((body) =>
			body.map((item) => (item as { session_id: string }).session_id),
		);

describe("unsent session usage summaries at SessionStart", () => {
	it("sends the summaries of other sessions unchanged for 10 minutes, next to the registration", async () => {
		const data = pluginData();
		await unsentSession(data, "s-a", T0);
		const h = await startAt(data, T0 + 10 * MINUTE);
		expect(h.requests.map((r) => new URL(r.url).pathname).sort()).toEqual([
			"/v1/session-usage",
			"/v1/sessions",
		]);
		expect(h.bodiesTo("/v1/session-usage")).toEqual([
			[
				expect.objectContaining({
					agent: "claude_code",
					session_id: "s-a",
					started_at: new Date(T0).toISOString(),
				}),
			],
		]);
		expect(
			h.requests.find((r) => r.url.endsWith("/v1/session-usage"))?.init,
		).toMatchObject({
			headers: { authorization: "Bearer hf_ik_ws1_secret" },
			redirect: "error",
		});
		expect(h.out()).toBe(sessionContextLine({}, "current"));
		expect(h.err()).toBe("");
	});

	// 同じ端末で動いている別のsessionの途中の要約を送らない。
	it("leaves a session changed less than 10 minutes ago", async () => {
		const data = pluginData();
		await unsentSession(data, "s-a", T0);
		const h = await startAt(data, T0 + 10 * MINUTE - 1000);
		expect(sentSessions(h)).toEqual([]);
	});

	it("does not send the session that is starting", async () => {
		const data = pluginData();
		await unsentSession(data, "current", T0);
		const h = await startAt(data, T0 + 11 * MINUTE, {}, { source: "resume" });
		expect(h.requests).toEqual([]);
	});

	it.each(["resume", "compact"])("sends them on %s as well", async (source) => {
		const data = pluginData();
		await unsentSession(data, "s-a", T0);
		const h = await startAt(data, T0 + 11 * MINUTE, {}, { source });
		expect(sentSessions(h)).toEqual([["s-a"]]);
	});

	// SessionEndは利用者用のkeyで送らないため、次のsessionの開始が送る。
	it("sends a user-key session's summary with the user key", async () => {
		const data = pluginData();
		const userKey = {
			managed: null,
			env: {
				HARNESSFORCE_ENDPOINT: "https://ingest.example.test",
				HARNESSFORCE_WORKSPACE_ID: "ws1",
			},
			userKey: { kind: "found", key: "hf_ik_ws1_user" },
		} as const;
		await unsentSession(data, "s-a", T0, userKey);
		const h = await startAt(data, T0 + 11 * MINUTE, userKey);
		expect(sentSessions(h)).toEqual([["s-a"]]);
		expect(
			h.requests.find((r) => r.url.endsWith("/v1/session-usage"))?.init,
		).toMatchObject({ headers: { authorization: "Bearer hf_ik_ws1_user" } });
	});

	it("sends only the sessions recorded for the Workspace of the key", async () => {
		const data = pluginData();
		await unsentSession(data, "s-a", T0);
		await unsentSession(data, "s-b", T0, {
			managed: { HARNESSFORCE_INGEST_KEY: "hf_ik_ws2_secret" },
		});
		const h = await startAt(data, T0 + 11 * MINUTE);
		expect(sentSessions(h)).toEqual([["s-a"]]);
	});

	it("sends at most 20 sessions, oldest change first, in one request", async () => {
		const data = pluginData();
		const ids = Array.from({ length: 21 }, (_, i) => `s-${i}`);
		for (const [i, id] of ids.entries())
			await unsentSession(data, id, T0 + (20 - i) * MINUTE);
		const h = await startAt(data, T0 + 60 * MINUTE);
		expect(sentSessions(h)).toEqual([ids.slice(1).reverse()]);
	});

	// rejectedに含まれた要素も、同じ内容で送り直しても受け付けられないため送り直さない。
	it("does not send a session again after a 2xx until its record grows", async () => {
		const data = pluginData();
		await unsentSession(data, "s-a", T0);
		await startAt(data, T0 + 11 * MINUTE);
		const again = await startAt(data, T0 + 12 * MINUTE);
		expect(sentSessions(again)).toEqual([]);
		await run(
			at(harness({ env: { CLAUDE_PLUGIN_DATA: data } }), T0 + 13 * MINUTE),
			"permission-request",
			"s-a",
		);
		touch(data, "s-a", T0 + 13 * MINUTE);
		const grown = await startAt(data, T0 + 30 * MINUTE);
		expect(grown.bodiesTo("/v1/session-usage")).toEqual([
			[expect.objectContaining({ session_id: "s-a", permission_requests: 1 })],
		]);
	});

	it("sends the session again at the next start after a failed send", async () => {
		const data = pluginData();
		await unsentSession(data, "s-a", T0);
		const failed = await startAt(data, T0 + 11 * MINUTE, {
			statusFor: (url) => (url.endsWith("/v1/session-usage") ? 503 : undefined),
		});
		expect(failed.out()).toBe(sessionContextLine({}, "current"));
		expect(failed.err()).toBe(
			"harnessforce: session usage failed (HTTP 503)\n",
		);
		const next = await startAt(data, T0 + 12 * MINUTE);
		expect(sentSessions(next)).toEqual([["s-a"]]);
	});

	it("shows the revoked-key notice once and marks the session on 401", async () => {
		const data = pluginData();
		const pad = scratchpad();
		await unsentSession(data, "s-a", T0);
		const h = await startAt(
			data,
			T0 + 11 * MINUTE,
			{
				statusFor: (url) =>
					url.endsWith("/v1/session-usage") ? 401 : undefined,
			},
			{ scratchpad_dir: pad },
		);
		expect(h.out()).toBe(
			sessionContextLine({ systemMessage: WORKSPACE_KEY_REVOKED }, "current"),
		);
		expect(existsSync(join(pad, "unauthorized-current"))).toBe(true);
	});

	it("sends nothing once the starting session is marked unauthorized", async () => {
		const data = pluginData();
		const pad = scratchpad();
		writeFileSync(join(pad, "unauthorized-current"), "");
		await unsentSession(data, "s-a", T0);
		const h = await startAt(
			data,
			T0 + 11 * MINUTE,
			{},
			{ scratchpad_dir: pad },
		);
		expect(h.requests).toEqual([]);
	});

	// privacy-and-retention.md「sessionの利用の要約」: 端末の記録のfileは最後の変更から30日で削除する。
	it("removes up to 100 files of usage/ unchanged for more than 30 days", async () => {
		const data = pluginData();
		await unsentSession(data, "s-a", T0);
		const usage = join(data, "usage");
		const stale = T0 - 30 * DAY - 1000;
		for (let i = 0; i < 101; i++) {
			const file = join(usage, `old-${i}.json`);
			writeFileSync(file, "{}");
			utimesSync(file, stale / 1000, stale / 1000);
		}
		const recent = join(usage, "recent.json");
		writeFileSync(recent, "{}");
		utimesSync(recent, (T0 - 30 * DAY) / 1000, (T0 - 30 * DAY) / 1000);
		await startAt(data, T0);
		const left = readdirSync(usage);
		expect(left.filter((name) => name.startsWith("old-"))).toHaveLength(1);
		expect(left).toEqual(
			expect.arrayContaining(["recent.json", "s-a.json", "s-a.jsonl"]),
		);
	});
});
