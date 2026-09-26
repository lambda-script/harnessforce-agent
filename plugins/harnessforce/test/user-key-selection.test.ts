import { describe, expect, it } from "vitest";
import { runHook } from "../src/hook.js";
import {
	type Harness,
	harness,
	isRegistration,
	REPO,
	scratchpad,
} from "./support.js";

// correlation.md「hook」の共通の規則が、選んだkeyの種類ごとに定める文言。
const USER_KEY_REVOKED =
	"送信キーが失効しています。`hf init`を実行してください";
const WORKSPACE_KEY_REVOKED =
	"組織の送信キーが失効しています。Workspaceの管理者に連絡してください";

// Workspace用のkeyを持たず、hf initで設定した端末。
const userEnv = {
	HARNESSFORCE_INGEST_KEY: undefined,
	HARNESSFORCE_WORKSPACE_ID: "ws1",
};
const userKey = { kind: "found", key: "hf_ik_ws1_user" } as const;

const event =
	(name: string) =>
	(h: Harness, input: Record<string, unknown> = {}) =>
		runHook(
			name,
			JSON.stringify({
				session_id: "s-1",
				cwd: REPO.cwd,
				source: "startup",
				...input,
			}),
			h.deps,
		);
const start = event("session-start");
const submit = event("user-prompt-submit");

describe("hook key selection", () => {
	it("sends with the user key read through hf otel-headers", async () => {
		const h = harness({ env: userEnv, userKey });
		await start(h);
		expect(h.userKeyReads()).toBe(1);
		expect(h.requests[0]?.init.headers).toMatchObject({
			authorization: "Bearer hf_ik_ws1_user",
		});
		expect(h.bodies()[0]?.[0]).toMatchObject({ source: "hook" });
		expect(h.err()).toBe("");
	});

	it("prefers the Workspace key and does not start hf", async () => {
		const h = harness({
			env: { ...userEnv, HARNESSFORCE_INGEST_KEY: "hf_ik_ws9_managed" },
			userKey,
		});
		await start(h);
		expect(h.userKeyReads()).toBe(0);
		expect(h.requests[0]?.init.headers).toMatchObject({
			authorization: "Bearer hf_ik_ws9_managed",
		});
	});

	it("does not start hf without HARNESSFORCE_WORKSPACE_ID", async () => {
		const h = harness({
			env: { ...userEnv, HARNESSFORCE_WORKSPACE_ID: undefined },
			userKey,
		});
		await start(h);
		expect(h.userKeyReads()).toBe(0);
		expect(h.requests).toEqual([]);
		expect(h.err()).toBe(
			"harnessforce: session registration skipped (no ingest key)\n",
		);
	});

	it("checks the endpoint before reading the user key", async () => {
		const h = harness({
			env: { ...userEnv, HARNESSFORCE_ENDPOINT: undefined },
			userKey,
		});
		await start(h);
		expect(h.userKeyReads()).toBe(0);
		expect(h.err()).toBe(
			"harnessforce: session registration skipped (invalid endpoint)\n",
		);
	});

	it("treats hf missing from PATH as no key without a read failure line", async () => {
		const h = harness({ env: userEnv, userKey: { kind: "missing" } });
		await start(h);
		expect(h.requests).toEqual([]);
		expect(h.out()).toBe("");
		expect(h.err()).toBe(
			"harnessforce: session registration skipped (no ingest key)\n",
		);
	});

	it("reports a failed keychain read and treats it as no key", async () => {
		const h = harness({ env: userEnv, userKey: { kind: "failed" } });
		await start(h, { scratchpad_dir: scratchpad() });
		expect(h.requests).toEqual([]);
		expect(h.out()).toBe("");
		expect(h.err()).toBe(
			"harnessforce: no user key in keychain or read failed\n" +
				"harnessforce: session registration skipped (no ingest key)\n",
		);
	});

	it("does not start hf again after the first prompt was sent", async () => {
		const h = harness({ env: userEnv, userKey });
		const dir = scratchpad();
		await start(h, { scratchpad_dir: dir });
		await submit(h, { scratchpad_dir: dir, prompt_id: "p-1" });
		await submit(h, { scratchpad_dir: dir, prompt_id: "p-2" });
		expect(h.userKeyReads()).toBe(2);
		expect(h.requests).toHaveLength(2);
	});

	it.each([
		["the user key", { env: userEnv, userKey }, USER_KEY_REVOKED],
		["the Workspace key", {}, WORKSPACE_KEY_REVOKED],
	])("shows the revoked notice for %s once", async (_, options, message) => {
		const h = harness({ ...options, status: 401 });
		const dir = scratchpad();
		await start(h, { scratchpad_dir: dir });
		await submit(h, { scratchpad_dir: dir, prompt_id: "p-1" });
		expect(h.out()).toBe(`${JSON.stringify({ systemMessage: message })}\n`);
		expect(h.err()).toBe(`${message}\n`);
	});

	describe("HARNESSFORCE_ISSUE", () => {
		it("claims source=cli with the issue when the key is the user key", async () => {
			const h = harness({
				env: { ...userEnv, HARNESSFORCE_ISSUE: "ENG-42" },
				userKey,
			});
			const dir = scratchpad();
			await start(h, { scratchpad_dir: dir });
			await submit(h, { scratchpad_dir: dir, prompt_id: "p-1" });
			const [first, second] = h.bodiesTo("/v1/sessions");
			expect(first?.[0]).toMatchObject({
				source: "cli",
				issue_identifier: "ENG-42",
			});
			expect(isRegistration(first?.[0])).toBe(true);
			expect(second?.[0]).toMatchObject({
				source: "cli",
				issue_identifier: "ENG-42",
				first_prompt_id: "p-1",
			});
		});

		it("does not claim source=cli with the Workspace key", async () => {
			const h = harness({ env: { HARNESSFORCE_ISSUE: "ENG-42" } });
			await start(h);
			expect(h.bodies()[0]?.[0]).toMatchObject({ source: "hook" });
			expect(h.bodies()[0]?.[0]).not.toHaveProperty("issue_identifier");
		});

		it.each([
			"",
			"ENG 42",
			"x".repeat(257),
		])("ignores the invalid identifier %j", async (issue) => {
			const h = harness({
				env: { ...userEnv, HARNESSFORCE_ISSUE: issue },
				userKey,
			});
			await start(h);
			expect(h.bodies()[0]?.[0]).toMatchObject({ source: "hook" });
			expect(h.bodies()[0]?.[0]).not.toHaveProperty("issue_identifier");
		});
	});
});
