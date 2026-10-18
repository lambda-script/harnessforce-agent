import { describe, expect, it } from "vitest";
import { runHook } from "../src/hook.js";
import {
	type Harness,
	harness,
	pluginData,
	REPO,
	sessionContext,
} from "./support.js";

// correlation.md「hookの警告」の文言。
const NOT_CONFIGURED =
	"Harnessforce sending is not configured. Run `/harnessforce:setup`";
const INVALID_ENDPOINT =
	"The Harnessforce destination is invalid. Run `harnessforce init` again";
const REGISTRATION_FAILED =
	"Harnessforce session registration failed. Check your network connection";
const USER_KEY_REVOKED =
	"Your ingest key has been revoked. Run `harnessforce init`";
const KEY_MISSING =
	"Harnessforce cannot find your ingest key, so telemetry is not being sent. Run `harnessforce init`";
const KEY_UNREADABLE =
	"Harnessforce could not read your ingest key from the OS keychain, so telemetry may not be sent. Unlock the keychain or run `harnessforce init`";
const DESTINATION_MISMATCH =
	"Telemetry is not being sent because the Harnessforce destination differs from the one saved by `harnessforce init`. Check this repository's settings or run `harnessforce init` again";
const TELEMETRY_NOT_CONFIGURED =
	"Claude Code telemetry for Harnessforce is not configured. Run `harnessforce init`";

const start = (h: Harness, input: Record<string, unknown> = {}) =>
	runHook(
		"session-start",
		JSON.stringify({
			session_id: "s-1",
			cwd: REPO.cwd,
			source: "startup",
			...input,
		}),
		h.deps,
	);

const warned = (h: Harness) => JSON.parse(h.out());
const warning = (message: string) => sessionContext({ systemMessage: message });
const VALID_ENDPOINT = { HARNESSFORCE_ENDPOINT: "https://ingest.example.test" };
const USER_ENV = { ...VALID_ENDPOINT, HARNESSFORCE_WORKSPACE_ID: "ws1" };

describe("SessionStart hook warning", () => {
	it("warns that sending is not configured when neither a workspace key nor a workspace id exists", async () => {
		const h = harness({ managed: null, env: VALID_ENDPOINT });
		await start(h);
		expect(warned(h)).toEqual(warning(NOT_CONFIGURED));
		expect(h.requests).toEqual([]);
	});

	it("warns that sending is not configured when no endpoint exists, before judging the endpoint", async () => {
		const h = harness({ managed: null, env: {} });
		await start(h);
		expect(warned(h)).toEqual(warning(NOT_CONFIGURED));
	});

	it("warns about an endpoint that is set but not allowed", async () => {
		const h = harness({
			managed: { HARNESSFORCE_ENDPOINT: "http://ingest.example.test" },
		});
		await start(h);
		expect(warned(h)).toEqual(warning(INVALID_ENDPOINT));
	});

	// correlation.md「送信の健全性」: Claude CodeのotelHeadersHelperの通知だけでは気付けることを保証できないため、hookも示す。
	it.each([
		["the keychain has no key", { kind: "absent" }, KEY_MISSING],
		[
			"the destination is not verified",
			{ kind: "withheld" },
			DESTINATION_MISMATCH,
		],
		["the keychain cannot be read", { kind: "unreadable" }, KEY_UNREADABLE],
	] as const)(
		"warns when the workspace id exists but %s",
		async (_, userKey, message) => {
			const h = harness({ managed: null, env: USER_ENV, userKey });
			await start(h);
			expect(warned(h)).toEqual(warning(message));
			expect(h.err()).toContain("skipped (no ingest key)");
			expect(h.requests).toEqual([]);
		},
	);

	// harnessforceを起動できない端末では、Claude Codeのhelperも起動できずに通知し、導入はsetupが確かめる。
	it("does not warn when harnessforce is not on PATH", async () => {
		const h = harness({
			managed: null,
			env: USER_ENV,
			userKey: { kind: "missing" },
		});
		await start(h);
		expect(warned(h)).toEqual(sessionContext());
	});

	it.each(["resume", "compact"])(
		"does not warn about the key on %s",
		async (source) => {
			const h = harness({
				managed: null,
				env: USER_ENV,
				userKey: { kind: "absent" },
			});
			await start(h, { source });
			expect(warned(h)).toEqual(sessionContext());
		},
	);

	it("warns when the telemetry settings written by harnessforce init are missing", async () => {
		const h = harness({
			managed: null,
			env: USER_ENV,
			userKey: { kind: "found", key: "hf_ik_ws1_user" },
			telemetryConfigured: false,
		});
		await start(h);
		expect(warned(h)).toEqual(warning(TELEMETRY_NOT_CONFIGURED));
		expect(h.requests.length).toBeGreaterThan(0);
	});

	it("does not judge the telemetry settings for the workspace key", async () => {
		const h = harness({ telemetryConfigured: false });
		await start(h);
		expect(warned(h)).toEqual(sessionContext());
	});

	it("prefers a revoked key over missing telemetry settings", async () => {
		const h = harness({
			managed: null,
			env: USER_ENV,
			userKey: { kind: "found", key: "hf_ik_ws1_user" },
			telemetryConfigured: false,
			status: 401,
		});
		await start(h);
		expect(warned(h)).toEqual(warning(USER_KEY_REVOKED));
	});

	it("prefers missing telemetry settings over a failed registration", async () => {
		const h = harness({
			managed: null,
			env: USER_ENV,
			userKey: { kind: "found", key: "hf_ik_ws1_user" },
			telemetryConfigured: false,
			status: 500,
		});
		await start(h);
		expect(warned(h)).toEqual(warning(TELEMETRY_NOT_CONFIGURED));
	});

	it("shows nothing when sending is healthy", async () => {
		const h = harness({
			managed: null,
			env: USER_ENV,
			userKey: { kind: "found", key: "hf_ik_ws1_user" },
		});
		await start(h);
		expect(warned(h)).toEqual(sessionContext());
	});

	it.each([500, 404])(
		"warns once when the session registration fails with %i",
		async (status) => {
			const h = harness({ status });
			await start(h);
			expect(warned(h)).toEqual(warning(REGISTRATION_FAILED));
		},
	);

	it("warns when the connection fails", async () => {
		const h = harness({ fetchError: new Error("down") });
		await start(h);
		expect(warned(h)).toEqual(warning(REGISTRATION_FAILED));
	});

	it("does not warn when only the config snapshot fails", async () => {
		const h = harness({
			statusFor: (url) => (url.endsWith("v1/config-snapshots") ? 500 : 200),
		});
		await start(h);
		expect(warned(h)).toEqual(sessionContext());
	});

	it("shows only the revoked-key message when the key is also rejected", async () => {
		const h = harness({ status: 401 });
		await start(h);
		expect(warned(h).systemMessage).toContain("revoked");
		expect(h.out().match(/systemMessage/g)).toHaveLength(1);
	});

	it.each(["resume", "compact"])(
		"does not warn on source %s even when sending is not configured",
		async (source) => {
			const h = harness({ managed: null, env: {} });
			await start(h, { source });
			expect(warned(h)).toEqual(sessionContext());
		},
	);

	// Claude Codeはpluginのhookへ常にCLAUDE_PLUGIN_DATAを渡し、利用の要約のためにresumeとcompactでも送信先を選ぶ。
	it.each([
		["resume", "not configured", {}],
		["compact", "not configured", {}],
		[
			"resume",
			"an endpoint that is not allowed",
			{ HARNESSFORCE_ENDPOINT: "http://ingest.example.test" },
		],
		[
			"compact",
			"an endpoint that is not allowed",
			{ HARNESSFORCE_ENDPOINT: "http://ingest.example.test" },
		],
	])(
		"does not warn on source %s with plugin data and %s",
		async (source, _, env) => {
			const h = harness({
				managed: null,
				env: { ...env, CLAUDE_PLUGIN_DATA: pluginData() },
			});
			await start(h, { source });
			expect(warned(h)).toEqual(sessionContext());
		},
	);

	it("does not warn outside a git repository, which is not a misconfiguration", async () => {
		const h = harness({
			git: async () => undefined,
		});
		await start(h);
		expect(warned(h)).toEqual(sessionContext());
	});

	it("does not warn on a successful registration", async () => {
		const h = harness();
		await start(h);
		expect(warned(h)).toEqual(sessionContext());
	});

	it("keeps the revoked user-key message when the key is rejected", async () => {
		const h = harness({
			managed: null,
			env: { ...VALID_ENDPOINT, HARNESSFORCE_WORKSPACE_ID: "ws1" },
			userKey: { kind: "found", key: "hf_ik_u_secret" },
			status: 401,
		});
		await start(h);
		expect(warned(h).systemMessage).toBe(USER_KEY_REVOKED);
	});
});
