import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { hashFileContent } from "../../../packages/cli/src/config/canonical.js";
import { runHook } from "../src/hook.js";
import {
	fakeGit,
	type Harness,
	harness,
	isConfigSnapshot,
	REPO,
	scratchpad,
	tempDir,
} from "./support.js";

const WORKSPACE_KEY_REVOKED =
	"組織の送信キーが失効しています。Workspaceの管理者に連絡してください";
const RULE = "# Always run the tests\n";

function write(root: string, files: Record<string, string>) {
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	}
}

// userのrule 1つだけを持つhome directory。
function homeWithRule() {
	const home = tempDir("hf-home-");
	write(home, { ".claude/rules/testing.md": RULE });
	return home;
}

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

const ruleComponent = {
	kind: "rule",
	source: "user",
	id: "rules/testing.md",
	hash: hashFileContent(Buffer.from(RULE)),
};

describe("config snapshot from SessionStart", () => {
	it("sends one snapshot with the collected components next to the registration", async () => {
		const h = harness({ homeDir: homeWithRule() });
		await start(h);
		expect(h.requests.map((r) => r.url).sort()).toEqual([
			"https://ingest.example.test/v1/config-snapshots",
			"https://ingest.example.test/v1/sessions",
		]);
		const snapshots = h.bodiesTo("/v1/config-snapshots");
		expect(snapshots).toEqual([
			[
				{
					agent: "claude_code",
					session_id: "s-1",
					components: [ruleComponent],
				},
			],
		]);
		expect(isConfigSnapshot(snapshots[0]?.[0])).toBe(true);
		expect(
			h.requests.find((r) => r.url.endsWith("config-snapshots"))?.init,
		).toMatchObject({
			method: "POST",
			headers: { authorization: "Bearer hf_ik_ws1_secret" },
			redirect: "error",
		});
		expect(h.out()).toBe("");
		expect(h.err()).toBe("");
	});

	it("never sends file bodies", async () => {
		const h = harness({ homeDir: homeWithRule() });
		await start(h);
		expect(JSON.stringify(h.bodiesTo("/v1/config-snapshots"))).not.toContain(
			"Always run the tests",
		);
	});

	it("collects repository files from the git top-level directory", async () => {
		const project = tempDir("hf-project-");
		write(project, { "CLAUDE.md": "root" });
		const h = harness({
			git: fakeGit({ "rev-parse --show-toplevel": project }),
		});
		await start(h);
		expect(h.bodiesTo("/v1/config-snapshots")[0]?.[0]).toMatchObject({
			components: [{ kind: "rule", source: "repository", id: "CLAUDE.md" }],
		});
	});

	it("sends the snapshot but no registration outside a git repository", async () => {
		const cwd = tempDir("hf-plain-");
		write(cwd, { "CLAUDE.md": "plain" });
		const h = harness({ git: async () => undefined });
		await start(h, { cwd });
		expect(h.requests.map((r) => new URL(r.url).pathname)).toEqual([
			"/v1/config-snapshots",
		]);
		expect(h.bodiesTo("/v1/config-snapshots")[0]?.[0]).toMatchObject({
			components: [{ kind: "rule", source: "repository", id: "CLAUDE.md" }],
		});
	});

	it("sends no snapshot when there are no components", async () => {
		const h = harness();
		await start(h);
		expect(h.bodiesTo("/v1/config-snapshots")).toEqual([]);
		expect(h.requests).toHaveLength(1);
	});

	it.each(["resume", "compact"])("sends neither on %s", async (source) => {
		const h = harness({ homeDir: homeWithRule() });
		await start(h, { source });
		expect(h.requests).toEqual([]);
	});

	it("sends neither when the endpoint is invalid and reports it once", async () => {
		const h = harness({
			homeDir: homeWithRule(),
			managed: { HARNESSFORCE_ENDPOINT: "http://ingest.example.test" },
		});
		await start(h);
		expect(h.requests).toEqual([]);
		expect(h.err()).toBe(
			"harnessforce: session registration skipped (invalid endpoint)\n",
		);
	});

	it("sends neither once the session is marked unauthorized", async () => {
		const dir = scratchpad();
		writeFileSync(join(dir, "unauthorized-s-1"), "");
		const h = harness({ homeDir: homeWithRule() });
		await start(h, { scratchpad_dir: dir });
		expect(h.requests).toEqual([]);
	});

	it("shows one notice when both sends get 401 and marks the session", async () => {
		const dir = scratchpad();
		const h = harness({ homeDir: homeWithRule(), status: 401 });
		await start(h, { scratchpad_dir: dir });
		expect(h.requests).toHaveLength(2);
		expect(h.out()).toBe(
			`${JSON.stringify({ systemMessage: WORKSPACE_KEY_REVOKED })}\n`,
		);
		expect(h.err()).toBe(`${WORKSPACE_KEY_REVOKED}\n`);
		expect(existsSync(join(dir, "unauthorized-s-1"))).toBe(true);
	});

	it("shows the notice when only the snapshot gets 401", async () => {
		const dir = scratchpad();
		const h = harness({
			homeDir: homeWithRule(),
			statusFor: (url) => (url.endsWith("config-snapshots") ? 401 : undefined),
		});
		await start(h, { scratchpad_dir: dir });
		expect(JSON.parse(h.out())).toEqual({
			systemMessage: WORKSPACE_KEY_REVOKED,
		});
		expect(existsSync(join(dir, "unauthorized-s-1"))).toBe(true);
	});

	it("reports a failed snapshot separately from the registration", async () => {
		const h = harness({
			homeDir: homeWithRule(),
			statusFor: (url) => (url.endsWith("config-snapshots") ? 503 : undefined),
		});
		await start(h);
		expect(h.out()).toBe("");
		expect(h.err()).toBe("harnessforce: config snapshot failed (HTTP 503)\n");
	});

	it("reports a skipped snapshot when collection runs past its budget", async () => {
		const home = homeWithRule();
		let calls = 0;
		const h = harness({ homeDir: home });
		// 収集の開始時刻を読んだ後は、毎回2秒ずつ進む時計。
		h.deps.now = () => new Date(Date.UTC(2026, 8, 26) + 2000 * calls++);
		await start(h);
		expect(h.bodiesTo("/v1/config-snapshots")).toEqual([]);
		expect(h.err()).toBe("harnessforce: config snapshot skipped (timeout)\n");
		expect(h.bodiesTo("/v1/sessions")).toHaveLength(1);
	});
});
