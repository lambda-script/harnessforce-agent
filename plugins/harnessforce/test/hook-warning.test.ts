import { describe, expect, it } from "vitest";
import { runHook } from "../src/hook.js";
import { type Harness, harness, REPO, sessionContext } from "./support.js";

// correlation.md「hookの警告」の文言。
const NOT_CONFIGURED =
	"Harnessforceの送信が設定されていません。`/harnessforce:setup`を実行してください";
const INVALID_ENDPOINT =
	"Harnessforceの送信先が不正です。`harnessforce init`を実行し直してください";
const REGISTRATION_FAILED =
	"Harnessforceへのsession登録に失敗しました。通信を確かめてください";
const USER_KEY_REVOKED =
	"送信キーが失効しています。`harnessforce init`を実行してください";

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

	it("does not warn when the workspace id exists but the keychain has no key", async () => {
		const h = harness({
			managed: null,
			env: { ...VALID_ENDPOINT, HARNESSFORCE_WORKSPACE_ID: "ws1" },
		});
		await start(h);
		expect(warned(h)).toEqual(sessionContext());
		expect(h.err()).toContain("skipped (no ingest key)");
	});

	it.each([
		500, 404,
	])("warns once when the session registration fails with %i", async (status) => {
		const h = harness({ status });
		await start(h);
		expect(warned(h)).toEqual(warning(REGISTRATION_FAILED));
	});

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
		expect(warned(h).systemMessage).toContain("失効");
		expect(h.out().match(/systemMessage/g)).toHaveLength(1);
	});

	it.each([
		"resume",
		"compact",
	])("does not warn on source %s even when sending is not configured", async (source) => {
		const h = harness({ managed: null, env: {} });
		await start(h, { source });
		expect(warned(h)).toEqual(sessionContext());
	});

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
