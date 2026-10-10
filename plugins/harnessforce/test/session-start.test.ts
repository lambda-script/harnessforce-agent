import { existsSync, readFileSync } from "node:fs";
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
	sessionContext,
	sessionContextLine,
} from "./support.js";

// correlation.md「hook」の共通の規則が定める文言。
const WORKSPACE_KEY_REVOKED =
	"組織の送信キーが失効しています。Workspaceの管理者に連絡してください";

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

const registered = {
	agent: "claude_code",
	session_id: "s-1",
	repository: "github.com/acme/web",
	branch: REPO.branch,
	commit: REPO.commit,
	source: "hook",
	started_at: "2026-09-26T00:00:00.000Z",
};

describe("SessionStart hook", () => {
	it("registers the session with the origin remote, branch and commit", async () => {
		const h = harness();
		await start(h);
		expect(h.requests.map((r) => r.url)).toEqual([
			"https://ingest.example.test/v1/sessions",
		]);
		expect(h.requests[0]?.init).toMatchObject({
			method: "POST",
			headers: {
				authorization: "Bearer hf_ik_ws1_secret",
				"content-type": "application/json",
			},
			redirect: "error",
		});
		expect(h.bodies()).toEqual([[registered]]);
		expect(isRegistration(h.bodies()[0]?.[0])).toBe(true);
		expect(h.out()).toBe(sessionContextLine());
		expect(h.err()).toBe("");
	});

	it("uses the first remote when origin is missing", async () => {
		const h = harness({
			git: fakeGit({
				remote: "upstream\nfork",
				"remote get-url upstream": "https://github.com/acme/web.git",
			}),
		});
		await start(h);
		expect(h.bodies()[0]?.[0]).toMatchObject({
			repository: "github.com/acme/web",
		});
	});

	it("omits the branch on a detached HEAD", async () => {
		const h = harness({
			git: fakeGit({ "symbolic-ref --quiet --short HEAD": undefined }),
		});
		await start(h);
		expect(h.bodies()[0]?.[0]).not.toHaveProperty("branch");
		expect(h.bodies()[0]?.[0]).toMatchObject({ commit: REPO.commit });
	});

	it("registers without repository when the remote cannot be normalized", async () => {
		const h = harness({
			git: fakeGit({ "remote get-url origin": "/srv/git/web.git" }),
		});
		await start(h);
		expect(h.bodies()[0]?.[0]).not.toHaveProperty("repository");
		expect(h.bodies()[0]?.[0]).toMatchObject({
			branch: REPO.branch,
			commit: REPO.commit,
		});
		expect(isRegistration(h.bodies()[0]?.[0])).toBe(true);
	});

	it.each([
		[
			"outside a git repository",
			{ "rev-parse --is-inside-work-tree": undefined },
		],
		["in a repository without remotes", { remote: undefined }],
	])("does not register %s", async (_, overrides) => {
		const h = harness({ git: fakeGit(overrides) });
		await start(h);
		expect(h.requests).toEqual([]);
		expect(h.out()).toBe(sessionContextLine());
	});

	it.each([
		"resume",
		"compact",
		"unknown-source",
	])("does not register on source %s", async (source) => {
		const h = harness();
		await start(h, { source });
		expect(h.requests).toEqual([]);
		expect(h.out()).toBe(sessionContextLine());
		expect(h.err()).toBe("");
	});

	// semantic-conventions.md「値の形」: 文字数はcode pointで数える。
	it("accepts a session id of 256 code points beyond 256 UTF-16 units", async () => {
		const sessionId = "\u{1F600}".repeat(256);
		const h = harness();
		await start(h, { session_id: sessionId });
		expect(JSON.parse(h.out())).toEqual(sessionContext({}, sessionId));
	});

	it("escapes the session id by JSON serialization", async () => {
		const h = harness();
		await start(h, { session_id: 'a"b\\c' });
		expect(
			JSON.parse(h.out()).hookSpecificOutput.additionalContext.split("\n")[0],
		).toBe('harnessforce session_id: a"b\\c');
	});

	it("passes the session id it received to the agent context", async () => {
		const h = harness();
		await start(h, { session_id: "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0" });
		expect(JSON.parse(h.out())).toEqual(
			sessionContext({}, "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0"),
		);
	});

	it.each([
		"startup",
		"clear",
		"fork",
		undefined,
	])("registers on source %s", async (source) => {
		const h = harness();
		await start(h, { source });
		expect(h.requests).toHaveLength(1);
	});

	it.each([
		["missing", { HARNESSFORCE_ENDPOINT: undefined }],
		["empty", { HARNESSFORCE_ENDPOINT: "" }],
		[
			"plain http to a remote host",
			{ HARNESSFORCE_ENDPOINT: "http://ingest.example.test" },
		],
		["not a URL", { HARNESSFORCE_ENDPOINT: "ingest" }],
		["another scheme", { HARNESSFORCE_ENDPOINT: "ftp://ingest.example.test" }],
	])("skips with invalid endpoint when the endpoint is %s", async (_, managed) => {
		const h = harness({ managed });
		await start(h);
		expect(h.requests).toEqual([]);
		expect(h.out()).toBe(sessionContextLine());
		expect(h.err()).toBe(
			"harnessforce: session registration skipped (invalid endpoint)\n",
		);
	});

	it("reports only the endpoint when both endpoint and key are missing", async () => {
		const h = harness({
			managed: {
				HARNESSFORCE_ENDPOINT: undefined,
				HARNESSFORCE_INGEST_KEY: undefined,
			},
		});
		await start(h);
		expect(h.err()).toBe(
			"harnessforce: session registration skipped (invalid endpoint)\n",
		);
	});

	it.each([
		["missing", undefined],
		["empty", ""],
	])("skips with no ingest key when the key is %s", async (_, key) => {
		const h = harness({
			managed: { HARNESSFORCE_INGEST_KEY: key },
			env: {
				HARNESSFORCE_ENDPOINT: "https://ingest.example.test",
				HARNESSFORCE_WORKSPACE_ID: "ws1",
			},
		});
		const dir = scratchpad();
		await start(h, { scratchpad_dir: dir });
		expect(h.requests).toEqual([]);
		expect(h.out()).toBe(sessionContextLine());
		expect(h.err()).toBe(
			"harnessforce: session registration skipped (no ingest key)\n",
		);
		expect(existsSync(join(dir, "unauthorized-s-1"))).toBe(false);
	});

	it.each([
		[
			"https://ingest.example.test/base",
			"https://ingest.example.test/base/v1/sessions",
		],
		[
			"https://ingest.example.test/base/",
			"https://ingest.example.test/base/v1/sessions",
		],
		[
			"https://ingest.example.test/base//",
			"https://ingest.example.test/base/v1/sessions",
		],
		["http://localhost:8787", "http://localhost:8787/v1/sessions"],
		[
			"http://127.0.0.1:8787/ingest",
			"http://127.0.0.1:8787/ingest/v1/sessions",
		],
		["http://[::1]:8787", "http://[::1]:8787/v1/sessions"],
	])("sends %s to %s", async (endpoint, url) => {
		const h = harness({ managed: { HARNESSFORCE_ENDPOINT: endpoint } });
		await start(h);
		expect(h.requests.map((r) => r.url)).toEqual([url]);
	});

	it.each([
		[
			"https://ingest.example.test//evil.test/base",
			"https://ingest.example.test//evil.test/base/v1/sessions",
		],
		["http://localhost//evil.test/", "http://localhost//evil.test/v1/sessions"],
		[
			"https://user:pass@ingest.example.test/base?x=1#y",
			"https://ingest.example.test/base/v1/sessions",
		],
	])("keeps the endpoint host for %s", async (endpoint, url) => {
		const h = harness({ managed: { HARNESSFORCE_ENDPOINT: endpoint } });
		await start(h);
		expect(h.requests.map((r) => r.url)).toEqual([url]);
	});

	it("does not claim source=cli with the workspace key even when HARNESSFORCE_ISSUE is set", async () => {
		const h = harness({ env: { HARNESSFORCE_ISSUE: "ENG-42" } });
		await start(h);
		expect(h.bodies()).toEqual([[registered]]);
	});

	it("saves the registration to the scratchpad before sending", async () => {
		const dir = scratchpad();
		const h = harness();
		let savedAtSend: unknown;
		const send = h.deps.fetch;
		h.deps.fetch = async (url, init) => {
			savedAtSend = JSON.parse(
				readFileSync(join(dir, "registration-s-1.json"), "utf8"),
			);
			return send(url, init);
		};
		await start(h, { scratchpad_dir: dir });
		expect(savedAtSend).toEqual(registered);
	});

	it.each([
		["a relative scratchpad_dir", { scratchpad_dir: "tmp/scratch" }],
		["a session id outside [A-Za-z0-9_-]", { session_id: "s.1" }],
	])("does not write the scratchpad for %s", async (_, input) => {
		const dir = scratchpad();
		const h = harness();
		await start(h, { scratchpad_dir: dir, ...input });
		expect(h.requests).toHaveLength(1);
		expect(existsSync(join(dir, "registration-s-1.json"))).toBe(false);
		expect(existsSync(join(dir, "registration-s.1.json"))).toBe(false);
	});

	it("still registers when the scratchpad cannot be written", async () => {
		const h = harness();
		await expect(
			start(h, { scratchpad_dir: "/nonexistent/hf-scratch" }),
		).resolves.toBeUndefined();
		expect(h.requests).toHaveLength(1);
		expect(h.out()).toBe(sessionContextLine());
	});

	it("shows the workspace-key notice once on 401 and marks the session unauthorized", async () => {
		const dir = scratchpad();
		const h = harness({ status: 401 });
		await expect(start(h, { scratchpad_dir: dir })).resolves.toBeUndefined();
		expect(h.out()).toBe(
			sessionContextLine({ systemMessage: WORKSPACE_KEY_REVOKED }),
		);
		expect(h.err()).toContain(WORKSPACE_KEY_REVOKED);
		expect(existsSync(join(dir, "unauthorized-s-1"))).toBe(true);
	});

	it.each([
		"startup",
		"clear",
		"fork",
		undefined,
	])("sends nothing on source %s once the session is marked unauthorized", async (source) => {
		const dir = scratchpad();
		await start(harness({ status: 401 }), { scratchpad_dir: dir });
		const h = harness();
		await start(h, { scratchpad_dir: dir, source });
		expect(h.requests).toEqual([]);
		expect(h.out()).toBe(sessionContextLine());
	});

	it.each([
		400, 403, 413, 429, 500, 503,
	])("keeps the user out of it on HTTP %i", async (status) => {
		const dir = scratchpad();
		const h = harness({ status });
		await start(h, { scratchpad_dir: dir });
		expect(h.out()).toBe(sessionContextLine());
		expect(h.err()).toBe(
			`harnessforce: session registration failed (HTTP ${status})\n`,
		);
		expect(existsSync(join(dir, "unauthorized-s-1"))).toBe(false);
	});

	it("keeps the user out of it when the request fails", async () => {
		const h = harness({ fetchError: new TypeError("fetch failed") });
		await expect(start(h)).resolves.toBeUndefined();
		expect(h.out()).toBe(sessionContextLine());
		expect(h.err()).toBe(
			"harnessforce: session registration failed (TypeError)\n",
		);
	});

	it.each([
		["non-JSON input", "not json"],
		["a JSON array", "[]"],
		["a relative cwd", JSON.stringify({ session_id: "s-1", cwd: "work/web" })],
		["an empty cwd", JSON.stringify({ session_id: "s-1", cwd: "" })],
		[
			"a session id with spaces",
			JSON.stringify({ session_id: "s 1", cwd: REPO.cwd }),
		],
		["no session id", JSON.stringify({ cwd: REPO.cwd })],
		[
			"a session id with NEL (U+0085)",
			JSON.stringify({ session_id: "s\u00851", cwd: REPO.cwd }),
		],
	])("ignores %s", async (_, raw) => {
		const h = harness();
		await expect(
			runHook("session-start", raw, h.deps),
		).resolves.toBeUndefined();
		expect(h.requests).toEqual([]);
		expect(h.out()).toBe("");
	});

	it.each([
		"stop",
		"toString",
		"__proto__",
	])("ignores the unknown event %s", async (event) => {
		const h = harness();
		await runHook(
			event,
			JSON.stringify({ session_id: "s-1", cwd: REPO.cwd }),
			h.deps,
		);
		expect(h.requests).toEqual([]);
	});

	it("never rejects even when a dependency throws", async () => {
		const h = harness({
			git: async () => {
				throw new Error("boom");
			},
		});
		await expect(start(h)).resolves.toBeUndefined();
		expect(h.out()).toBe(sessionContextLine());
		// session registrationとconfig snapshotは別々にgitを使い、それぞれの失敗を書く。
		expect(h.err()).toBe("harnessforce: boom\nharnessforce: boom\n");
	});
});
