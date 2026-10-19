import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { describe, expect, it } from "vitest";
import { runHook } from "../src/hook.js";
import {
	type Harness,
	harness,
	PLUGIN_VERSION,
	pluginData,
	REPO,
	sessionContext,
} from "./support.js";

// client-updates.md「clientの扱い」のClaude Codeのpluginの側。

const NOW = new Date("2026-09-26T00:00:00Z");
const PLUGIN_UNSUPPORTED =
	"This Harnessforce plugin version is no longer supported, so nothing is being sent to Harnessforce. Update it: `claude plugin update harnessforce@harnessforce-agent`";
const CLI_UNSUPPORTED =
	"This Harnessforce CLI version is no longer supported, so nothing is being sent to Harnessforce. Update it: `npm install -g @harnessforce/cli@latest`";
const PLUGIN_OUTDATED =
	"Harnessforce plugin 9.9.9 is available. Update it: `claude plugin update harnessforce@harnessforce-agent`";
const USER_ENV = {
	HARNESSFORCE_ENDPOINT: "https://ingest.example.test",
	HARNESSFORCE_WORKSPACE_ID: "ws1",
};

function withState(dir: string, state: Record<string, unknown>) {
	writeFileSync(
		join(dir, "update-status.json"),
		JSON.stringify({ version: PLUGIN_VERSION, ...state }),
	);
	return dir;
}
const readState = (dir: string) =>
	JSON.parse(readFileSync(join(dir, "update-status.json"), "utf8"));

const run = (event: string, h: Harness, input: Record<string, unknown> = {}) =>
	runHook(
		event,
		JSON.stringify({
			session_id: "s-1",
			cwd: REPO.cwd,
			source: "startup",
			prompt_id: "p-1",
			...input,
		}),
		h.deps,
	);
const messageOf = (h: Harness) =>
	(JSON.parse(h.out()) as { systemMessage?: string }).systemMessage;

describe("plugin requests", () => {
	it("declare the plugin version and save the update status", async () => {
		const data = pluginData();
		const h = harness({
			env: { CLAUDE_PLUGIN_DATA: data },
			updateHeader: 'status=outdated, latest="9.9.9"',
		});
		await run("session-start", h);
		expect(h.requests.length).toBeGreaterThan(0);
		for (const request of h.requests)
			expect(
				(request.init.headers as Record<string, string>)["user-agent"],
			).toBe(`harnessforce-claude-code-plugin/${PLUGIN_VERSION}`);
		expect(readState(data)).toMatchObject({
			status: "outdated",
			latest: "9.9.9",
		});
		expect(messageOf(h)).toBe(PLUGIN_OUTDATED);
	});

	it("do not show outdated while Claude Code updates the plugin, or twice a day", async () => {
		const updating = harness({
			env: { CLAUDE_PLUGIN_DATA: pluginData() },
			updateHeader: 'status=outdated, latest="9.9.9"',
			pluginAutoUpdate: true,
		});
		await run("session-start", updating);
		expect(messageOf(updating)).toBeUndefined();

		const data = pluginData();
		const first = harness({
			env: { CLAUDE_PLUGIN_DATA: data },
			updateHeader: 'status=outdated, latest="9.9.9"',
		});
		await run("session-start", first);
		const second = harness({
			env: { CLAUDE_PLUGIN_DATA: data },
			updateHeader: 'status=outdated, latest="9.9.9"',
		});
		await run("session-start", second);
		expect(messageOf(first)).toBe(PLUGIN_OUTDATED);
		expect(messageOf(second)).toBeUndefined();
	});
});

describe("the order of the session start line", () => {
	it("shows a revoked key before the update line", async () => {
		const h = harness({
			env: { CLAUDE_PLUGIN_DATA: pluginData() },
			status: 401,
			updateHeader: "status=unsupported, reason=security",
		});
		await run("session-start", h);
		expect(messageOf(h)).toBe(
			"The organization's ingest key has been revoked. Contact a Workspace administrator",
		);
	});

	it("shows a sending warning before a newer version", async () => {
		const data = pluginData();
		const h = harness({
			env: { CLAUDE_PLUGIN_DATA: data },
			status: 500,
			updateHeader: 'status=outdated, latest="9.9.9"',
		});
		await run("session-start", h);
		expect(messageOf(h)).toBe(
			"Harnessforce session registration failed. Check your network connection",
		);
		expect(readState(data).outdatedShownAt).toBeUndefined();
	});
});

describe("while the plugin version is unsupported", () => {
	const unsupported = (receivedAt = NOW.toISOString()) => ({
		status: "unsupported",
		reason: "security",
		receivedAt,
	});

	it("SessionStart sends nothing and shows the update line with the session context", async () => {
		const h = harness({
			env: { CLAUDE_PLUGIN_DATA: withState(pluginData(), unsupported()) },
		});
		await run("session-start", h);
		expect(h.requests).toEqual([]);
		expect(JSON.parse(h.out())).toEqual(
			sessionContext({ systemMessage: PLUGIN_UNSUPPORTED }),
		);
	});

	it("UserPromptSubmit sends nothing even with a saved registration", async () => {
		const data = pluginData();
		const pad = tempDir("hf-pad-");
		const started = harness({ env: { CLAUDE_PLUGIN_DATA: data } });
		await run("session-start", started, { scratchpad_dir: pad });
		expect(
			started.requests.some((request) => request.url.endsWith("/v1/sessions")),
		).toBe(true);
		withState(data, unsupported());
		const h = harness({ env: { CLAUDE_PLUGIN_DATA: data } });
		await run("user-prompt-submit", h, { scratchpad_dir: pad });
		expect(h.requests).toEqual([]);
	});

	it("SessionEnd sends nothing for a session that would otherwise send its usage", async () => {
		const data = pluginData();
		await run("session-start", harness({ env: { CLAUDE_PLUGIN_DATA: data } }));
		const sending = harness({ env: { CLAUDE_PLUGIN_DATA: data } });
		await run("session-end", sending);
		expect(
			sending.requests.some((r) => r.url.endsWith("/v1/session-usage")),
		).toBe(true);

		const blockedData = pluginData();
		await run(
			"session-start",
			harness({ env: { CLAUDE_PLUGIN_DATA: blockedData } }),
		);
		withState(blockedData, unsupported());
		const blocked = harness({ env: { CLAUDE_PLUGIN_DATA: blockedData } });
		await run("session-end", blocked);
		expect(blocked.requests).toEqual([]);
	});

	it("rechecks without credentials after 24 hours and sends again when current", async () => {
		const data = withState(pluginData(), unsupported("2026-09-24T00:00:00Z"));
		const h = harness({
			env: { CLAUDE_PLUGIN_DATA: data },
			updateHeader: "status=current",
		});
		await run("session-start", h);
		const [check] = h.requests;
		expect(check?.url).toBe("https://ingest.example.test/v1/client-status");
		expect(check?.init.method).toBe("GET");
		expect(
			(check?.init.headers as Record<string, string> | undefined)
				?.authorization,
		).toBeUndefined();
		expect(readState(data).status).toBe("current");
		expect(
			h.requests.some((request) => request.url.endsWith("/v1/sessions")),
		).toBe(true);
	});
});

describe("while the CLI version is unsupported", () => {
	it("shows the CLI update line instead of the key warnings", async () => {
		const h = harness({
			managed: null,
			env: { ...USER_ENV, CLAUDE_PLUGIN_DATA: pluginData() },
			userKey: { kind: "cliUnsupported" },
		});
		await run("session-start", h);
		expect(messageOf(h)).toBe(CLI_UNSUPPORTED);
		expect(h.requests).toEqual([]);
	});

	it("rechecks the CLI status with the CLI version after 24 hours", async () => {
		const home = tempDir("hf-home-");
		mkdirSync(join(home, ".harnessforce"));
		writeFileSync(
			join(home, ".harnessforce", "update-status.json"),
			JSON.stringify({
				version: "0.1.5",
				status: "unsupported",
				reason: "security",
				receivedAt: "2026-09-24T00:00:00Z",
			}),
		);
		const h = harness({
			managed: null,
			homeDir: home,
			env: USER_ENV,
			userKey: { kind: "cliUnsupported" },
			updateHeader: "status=current",
		});
		await run("session-start", h);
		const [check] = h.requests;
		expect(check?.url).toBe("https://ingest.example.test/v1/client-status");
		expect(
			(check?.init.headers as Record<string, string> | undefined)?.[
				"user-agent"
			],
		).toBe("harnessforce-cli/0.1.5");
		expect(
			JSON.parse(
				readFileSync(join(home, ".harnessforce", "update-status.json"), "utf8"),
			).status,
		).toBe("current");
	});
});
