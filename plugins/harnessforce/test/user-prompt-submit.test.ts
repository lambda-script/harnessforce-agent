import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runHook } from "../src/hook.js";
import {
	fakeGit,
	type Harness,
	harness,
	isRegistration,
	REPO,
	scratchpad,
	sessionContextLine,
} from "./support.js";

const event =
	(name: string) =>
	(h: Harness, input: Record<string, unknown>): Promise<void> =>
		runHook(
			name,
			JSON.stringify({ session_id: "s-1", cwd: REPO.cwd, ...input }),
			h.deps,
		);
const start = event("session-start");
const submit = event("user-prompt-submit");

describe("UserPromptSubmit hook", () => {
	it("adds the first prompt id to the saved registration exactly once", async () => {
		const h = harness();
		const dir = scratchpad();
		await start(h, { scratchpad_dir: dir, source: "startup" });
		await submit(h, { scratchpad_dir: dir, prompt_id: "p-1" });
		await submit(h, { scratchpad_dir: dir, prompt_id: "p-2" });
		const [first, second, ...rest] = h.bodies();
		expect(rest).toEqual([]);
		expect(second).toEqual([
			{ ...(first?.[0] as object), first_prompt_id: "p-1" },
		]);
		expect(isRegistration(second?.[0])).toBe(true);
		expect(h.requests[1]?.url).toBe("https://ingest.example.test/v1/sessions");
		// UserPromptSubmitはcontextを出さない。stdoutはSessionStartのsession contextだけである。
		expect(h.out()).toBe(sessionContextLine());
	});

	it("claims the first prompt only once when prompts race", async () => {
		const h = harness();
		const dir = scratchpad();
		await start(h, { scratchpad_dir: dir });
		await Promise.all([
			submit(h, { scratchpad_dir: dir, prompt_id: "p-1" }),
			submit(h, { scratchpad_dir: dir, prompt_id: "p-2" }),
		]);
		expect(h.requests).toHaveLength(2);
	});

	it("keeps the branch and commit captured at session start", async () => {
		const overrides: Record<string, string | undefined> = {};
		const h = harness({ git: fakeGit(overrides) });
		const dir = scratchpad();
		await start(h, { scratchpad_dir: dir });
		overrides["symbolic-ref --quiet --short HEAD"] = "another-branch";
		await submit(h, { scratchpad_dir: dir, prompt_id: "p-1" });
		expect(h.bodies()[1]?.[0]).toMatchObject({
			branch: REPO.branch,
			commit: REPO.commit,
			first_prompt_id: "p-1",
		});
	});

	it("retries the registration when the SessionStart send failed", async () => {
		const dir = scratchpad();
		await start(harness({ status: 503 }), { scratchpad_dir: dir });
		const h = harness();
		await submit(h, { scratchpad_dir: dir, prompt_id: "p-1" });
		expect(h.bodies()).toEqual([
			[expect.objectContaining({ session_id: "s-1", first_prompt_id: "p-1" })],
		]);
	});

	it("sends for a new session id after /clear even with the same scratchpad", async () => {
		const h = harness();
		const dir = scratchpad();
		await start(h, { scratchpad_dir: dir });
		await submit(h, { scratchpad_dir: dir, prompt_id: "p-1" });
		await start(h, { scratchpad_dir: dir, session_id: "s-2", source: "clear" });
		await submit(h, {
			scratchpad_dir: dir,
			session_id: "s-2",
			prompt_id: "p-9",
		});
		expect(h.bodies().map((body) => body[0])).toEqual([
			expect.objectContaining({ session_id: "s-1" }),
			expect.objectContaining({ session_id: "s-1", first_prompt_id: "p-1" }),
			expect.objectContaining({ session_id: "s-2" }),
			expect.objectContaining({ session_id: "s-2", first_prompt_id: "p-9" }),
		]);
	});

	it("sends nothing when SessionStart did not register (outside git)", async () => {
		const h = harness({
			git: fakeGit({ "rev-parse --is-inside-work-tree": undefined }),
		});
		const dir = scratchpad();
		await start(h, { scratchpad_dir: dir });
		await submit(h, { scratchpad_dir: dir, prompt_id: "p-1" });
		expect(h.requests).toEqual([]);
	});

	it("sends nothing when the saved registration is unreadable", async () => {
		const h = harness();
		const dir = scratchpad();
		writeFileSync(join(dir, "registration-s-1.json"), "{broken");
		await submit(h, { scratchpad_dir: dir, prompt_id: "p-1" });
		expect(h.requests).toEqual([]);
		expect(h.out()).toBe("");
	});

	it("sends nothing when the saved registration belongs to another session", async () => {
		const h = harness();
		const dir = scratchpad();
		writeFileSync(
			join(dir, "registration-s-1.json"),
			JSON.stringify({ session_id: "other", agent: "claude_code" }),
		);
		await submit(h, { scratchpad_dir: dir, prompt_id: "p-1" });
		expect(h.requests).toEqual([]);
	});

	it.each([
		["without scratchpad_dir", (_dir: string) => ({ prompt_id: "p-1" })],
		["without prompt_id", (dir: string) => ({ scratchpad_dir: dir })],
		[
			"with a session id outside [A-Za-z0-9_-]",
			(dir: string) => ({
				session_id: "s.1",
				prompt_id: "p-1",
				scratchpad_dir: dir,
			}),
		],
	])("sends nothing %s", async (_, inputFor) => {
		const dir = scratchpad();
		await start(harness(), { scratchpad_dir: dir });
		const h = harness();
		await submit(h, inputFor(dir));
		expect(h.requests).toEqual([]);
	});

	it("sends nothing once the session is marked unauthorized", async () => {
		const h = harness({ status: 401 });
		const dir = scratchpad();
		await start(h, { scratchpad_dir: dir });
		await submit(h, { scratchpad_dir: dir, prompt_id: "p-1" });
		expect(h.requests).toHaveLength(1);
		expect(h.out().trim().split("\n")).toHaveLength(1);
	});

	it("shows the notice and marks the session when the first prompt gets 401", async () => {
		const dir = scratchpad();
		await start(harness({ status: 503 }), { scratchpad_dir: dir });
		const h = harness({ status: 401 });
		await submit(h, { scratchpad_dir: dir, prompt_id: "p-1" });
		expect(JSON.parse(h.out())).toEqual({
			systemMessage:
				"組織の送信キーが失効しています。Workspaceの管理者に連絡してください",
		});
		const later = harness();
		await start(later, { scratchpad_dir: dir, source: "clear" });
		expect(later.requests).toEqual([]);
	});

	it("skips with invalid endpoint when the endpoint disappeared", async () => {
		const dir = scratchpad();
		await start(harness(), { scratchpad_dir: dir });
		const h = harness({ managed: { HARNESSFORCE_ENDPOINT: undefined } });
		await submit(h, { scratchpad_dir: dir, prompt_id: "p-1" });
		expect(h.requests).toEqual([]);
		expect(h.err()).toBe(
			"harnessforce: session registration skipped (invalid endpoint)\n",
		);
	});
});
