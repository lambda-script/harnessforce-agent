import { describe, expect, it } from "vitest";
import { runHook } from "../src/hook.js";
import {
	type Harness,
	harness,
	isRegistration,
	MANAGED_ENV,
	managedDir,
	REPO,
	scratchpad,
} from "./support.js";

// correlation.md「hook」の共通の規則が、選んだkeyの種類ごとに定める文言。
const USER_KEY_REVOKED =
	"送信キーが失効しています。`hf init`を実行してください";
const WORKSPACE_KEY_REVOKED =
	"組織の送信キーが失効しています。Workspaceの管理者に連絡してください";

// managed settingsのfileを持たず、hf initで設定した端末。
const userEnv = {
	HARNESSFORCE_ENDPOINT: "https://ingest.example.test",
	HARNESSFORCE_WORKSPACE_ID: "ws1",
};
const noManaged = { managed: null };
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
		const h = harness({ ...noManaged, env: userEnv, userKey });
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
			env: userEnv,
			managed: { HARNESSFORCE_INGEST_KEY: "hf_ik_ws9_managed" },
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
			...noManaged,
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
			...noManaged,
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
		const h = harness({
			...noManaged,
			env: userEnv,
			userKey: { kind: "missing" },
		});
		await start(h);
		expect(h.requests).toEqual([]);
		expect(h.out()).toBe("");
		expect(h.err()).toBe(
			"harnessforce: session registration skipped (no ingest key)\n",
		);
	});

	it("reports a failed keychain read and treats it as no key", async () => {
		const h = harness({
			...noManaged,
			env: userEnv,
			userKey: { kind: "failed" },
		});
		await start(h, { scratchpad_dir: scratchpad() });
		expect(h.requests).toEqual([]);
		expect(h.out()).toBe("");
		expect(h.err()).toBe(
			"harnessforce: no user key in keychain or read failed\n" +
				"harnessforce: session registration skipped (no ingest key)\n",
		);
	});

	it("does not start hf again after the first prompt was sent", async () => {
		const h = harness({ ...noManaged, env: userEnv, userKey });
		const dir = scratchpad();
		await start(h, { scratchpad_dir: dir });
		await submit(h, { scratchpad_dir: dir, prompt_id: "p-1" });
		await submit(h, { scratchpad_dir: dir, prompt_id: "p-2" });
		expect(h.userKeyReads()).toBe(2);
		expect(h.requests).toHaveLength(2);
	});

	it.each([
		["the user key", { ...noManaged, env: userEnv, userKey }, USER_KEY_REVOKED],
		["the Workspace key", {}, WORKSPACE_KEY_REVOKED],
	])("shows the revoked notice for %s once", async (_, options, message) => {
		const h = harness({ ...options, status: 401 });
		const dir = scratchpad();
		await start(h, { scratchpad_dir: dir });
		await submit(h, { scratchpad_dir: dir, prompt_id: "p-1" });
		expect(h.out()).toBe(`${JSON.stringify({ systemMessage: message })}\n`);
		expect(h.err()).toBe(`${message}\n`);
	});

	describe("Workspace key from managed settings files only", () => {
		const repositoryEnv = {
			...userEnv,
			HARNESSFORCE_ENDPOINT: "https://evil.example.test",
			HARNESSFORCE_INGEST_KEY: "hf_ik_evil_key",
		};

		it("ignores a Workspace key and endpoint set through the process environment", async () => {
			const h = harness({ ...noManaged, env: repositoryEnv });
			await start(h);
			expect(h.requests).toEqual([]);
			expect(h.err()).toBe(
				"harnessforce: session registration skipped (no ingest key)\n",
			);
		});

		it("falls back to the user key path when there is no managed file", async () => {
			const h = harness({ ...noManaged, env: repositoryEnv, userKey });
			await start(h);
			expect(h.userKeyReads()).toBe(1);
			expect(h.requests[0]?.init.headers).toMatchObject({
				authorization: "Bearer hf_ik_ws1_user",
			});
		});

		it("uses the managed key and managed endpoint over the process environment", async () => {
			const h = harness({
				env: repositoryEnv,
				managed: { HARNESSFORCE_ENDPOINT: "https://managed.example.test/base" },
				userKey,
			});
			await start(h);
			expect(h.userKeyReads()).toBe(0);
			expect(h.requests.map((r) => r.url)).toEqual([
				"https://managed.example.test/base/v1/sessions",
			]);
			expect(h.requests[0]?.init.headers).toMatchObject({
				authorization: "Bearer hf_ik_ws1_secret",
			});
		});

		it("takes each variable from the last managed drop-in that sets it", async () => {
			const h = harness({ env: {} });
			h.deps.managedDir = managedDir(
				{ env: { ...MANAGED_ENV, HARNESSFORCE_INGEST_KEY: "hf_ik_ws1_base" } },
				{
					"10-key.json": JSON.stringify({
						env: { HARNESSFORCE_INGEST_KEY: "hf_ik_ws1_dropin" },
					}),
					"20-broken.json": "{",
					"30-other.json": JSON.stringify({ env: { OTHER: "x" } }),
				},
			);
			await start(h);
			expect(h.requests[0]?.url).toBe(
				"https://ingest.example.test/v1/sessions",
			);
			expect(h.requests[0]?.init.headers).toMatchObject({
				authorization: "Bearer hf_ik_ws1_dropin",
			});
		});
	});

	describe("HARNESSFORCE_ISSUE", () => {
		it("claims source=cli with the issue when the key is the user key", async () => {
			const h = harness({
				...noManaged,
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
			const h = harness({ env: { ...userEnv, HARNESSFORCE_ISSUE: "ENG-42" } });
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
				...noManaged,
				env: { ...userEnv, HARNESSFORCE_ISSUE: issue },
				userKey,
			});
			await start(h);
			expect(h.bodies()[0]?.[0]).toMatchObject({ source: "hook" });
			expect(h.bodies()[0]?.[0]).not.toHaveProperty("issue_identifier");
		});
	});
});
