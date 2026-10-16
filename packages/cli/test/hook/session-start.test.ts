import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { usingHarnessforceBody } from "@harnessforce/agent-core/using-harnessforce";
import { SessionRegistrationSchema } from "@harnessforce/semconv";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { compileSchema } from "@harnessforce/test-support/validator";
import { describe, expect, it } from "vitest";
import {
	ingestKeyAccount,
	ingestOriginAccount,
} from "../../src/credentials/keychain.js";
import { fakeKeychain, runCli } from "../support/cli.js";

// correlation.md「Codex」の「Codexのhook」。CodexのSessionStartのhookが起動する`harnessforce hook session-start`。
const isRegistration = compileSchema(SessionRegistrationSchema);
const WORKSPACE = "019f0000-0000-7000-8000-000000000001";
const ENDPOINT = "https://ingest.example.test/base";
const KEY = "hf_ik_secretkeyvalue";
const NOW = new Date("2026-10-09T12:00:00Z");
const REVOKED = "Your ingest key has been revoked. Run `harnessforce init`";

const gitRepo = async (cwd: string, args: readonly string[]) => {
	if (cwd !== "/work/web") return undefined;
	if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree")
		return "true";
	if (args[0] === "rev-parse") return "a".repeat(40);
	if (args[0] === "remote" && args.length === 1) return "origin";
	if (args[0] === "remote") return "git@github.com:Acme/Web.git";
	if (args[0] === "symbolic-ref") return "feature/ENG-42";
	return undefined;
};

type Sent = {
	url: string;
	headers: Record<string, string>;
	body: unknown;
	redirect?: string;
};

function setup(
	options: {
		input?: unknown;
		env?: Record<string, string>;
		userSettingsEnv?: Record<string, string>;
		keychain?: Parameters<typeof fakeKeychain>[0];
		status?: number;
		fetchFails?: boolean;
		git?: typeof gitRepo;
	} = {},
) {
	const home = tempDir("hf-hook-home-");
	if (options.userSettingsEnv) {
		mkdirSync(join(home, ".claude"), { recursive: true });
		writeFileSync(
			join(home, ".claude", "settings.json"),
			JSON.stringify({ env: options.userSettingsEnv }),
		);
	}
	const sent: Sent[] = [];
	const { keychain } = fakeKeychain(
		options.keychain ?? {
			items: {
				[ingestKeyAccount(WORKSPACE)]: KEY,
				[ingestOriginAccount(WORKSPACE)]: "https://ingest.example.test",
			},
		},
	);
	const input = options.input ?? {
		session_id: "sess-1",
		cwd: "/work/web",
		source: "startup",
		hook_event_name: "SessionStart",
	};
	const run = (args = ["hook", "session-start"], extra = {}) =>
		runCli(args, {
			homeDir: home,
			env: {
				HARNESSFORCE_WORKSPACE_ID: WORKSPACE,
				HARNESSFORCE_ENDPOINT: ENDPOINT,
				...options.env,
			},
			keychain,
			now: () => NOW,
			hookGit: (options.git ?? gitRepo) as never,
			readStdin: async () =>
				Buffer.from(typeof input === "string" ? input : JSON.stringify(input)),
			fetch: async (url, init) => {
				if (options.fetchFails) throw new Error("network down");
				sent.push({
					url: String(url),
					headers: Object.fromEntries(
						Object.entries((init?.headers ?? {}) as Record<string, string>),
					),
					body: JSON.parse(String(init?.body)),
					...(init?.redirect ? { redirect: init.redirect } : {}),
				});
				return new Response(null, { status: options.status ?? 202 });
			},
			...extra,
		});
	return { run, sent };
}

const context = (id: string) => ({
	hookSpecificOutput: {
		hookEventName: "SessionStart",
		additionalContext: `harnessforce session_id: ${id}\n\n${usingHarnessforceBody}`,
	},
});

describe("harnessforce hook session-start", () => {
	it("registers the Codex session with the user key and prints the session context", async () => {
		const { run, sent } = setup();
		const result = await run();
		expect(result.code).toBe(0);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.url).toBe(`${ENDPOINT}/v1/sessions`);
		expect(sent[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
		expect(sent[0]?.redirect).toBe("error");
		const body = sent[0]?.body as unknown[];
		const [registration] = body;
		expect(registration).toEqual({
			agent: "codex",
			session_id: "sess-1",
			repository: "github.com/acme/web",
			branch: "feature/ENG-42",
			commit: "a".repeat(40),
			source: "hook",
			started_at: NOW.toISOString(),
		});
		expect(isRegistration(registration)).toBe(true);
		expect(JSON.parse(result.out)).toEqual(context("sess-1"));
		expect(result.out + result.err).not.toContain(KEY);
	});

	it("claims source=cli with the issue only when HARNESSFORCE_ISSUE is a valid identifier", async () => {
		const valid = setup({ env: { HARNESSFORCE_ISSUE: "ENG-42" } });
		await valid.run();
		const validBody = valid.sent[0]?.body as {
			source: string;
			issue_identifier: string;
		}[];
		expect(validBody[0]).toMatchObject({
			source: "cli",
			issue_identifier: "ENG-42",
		});
		const invalid = setup({ env: { HARNESSFORCE_ISSUE: "not an issue" } });
		await invalid.run();
		const invalidBody = invalid.sent[0]?.body as Record<string, unknown>[];
		const [registration] = invalidBody;
		expect(registration).toMatchObject({ source: "hook" });
		expect(registration).not.toHaveProperty("issue_identifier");
	});

	it.each([
		["startup", true],
		["clear", true],
		[undefined, true],
		["resume", false],
		["compact", false],
	])(
		"source %s sends=%s, and always prints the context",
		async (source, sends) => {
			const { run, sent } = setup({
				input: {
					session_id: "sess-1",
					cwd: "/work/web",
					...(source ? { source } : {}),
				},
			});
			const result = await run();
			expect(sent).toHaveLength(sends ? 1 : 0);
			expect(JSON.parse(result.out)).toEqual(context("sess-1"));
		},
	);

	it("reads the workspace and the endpoint from the Claude Code user settings when the environment has none", async () => {
		const { run, sent } = setup({
			env: { HARNESSFORCE_WORKSPACE_ID: "", HARNESSFORCE_ENDPOINT: "" },
			userSettingsEnv: {
				HARNESSFORCE_WORKSPACE_ID: WORKSPACE,
				HARNESSFORCE_ENDPOINT: ENDPOINT,
			},
		});
		await run();
		expect(sent).toHaveLength(1);
		expect(sent[0]?.url).toBe(`${ENDPOINT}/v1/sessions`);
	});

	// correlation.md「hookの警告」: Codexのhookは、session contextのJSONのobjectの`systemMessage`で警告を出す。
	const warned = (message: string) => ({
		...context("sess-1"),
		systemMessage: message,
	});
	const KEY_MISSING =
		"Harnessforce cannot find your ingest key, so sessions are not being registered. Run `harnessforce init`";
	const KEY_UNREADABLE =
		"Harnessforce could not read your ingest key from the OS keychain, so sessions may not be registered. Unlock the keychain or run `harnessforce init`";
	const DESTINATION_MISMATCH =
		"Sessions are not being registered because the Harnessforce destination differs from the one saved by `harnessforce init`. Run `harnessforce init` again";
	const NOT_CONFIGURED =
		"Harnessforce sending is not configured. Run `harnessforce init`";
	const INVALID_ENDPOINT =
		"The Harnessforce destination is invalid. Run `harnessforce init` again";
	const REGISTRATION_FAILED =
		"Harnessforce session registration failed. Check your network connection";

	it.each([
		[
			"no workspace and no endpoint",
			{ HARNESSFORCE_WORKSPACE_ID: "", HARNESSFORCE_ENDPOINT: "" },
		],
		["no workspace id", { HARNESSFORCE_WORKSPACE_ID: "" }],
		["no endpoint", { HARNESSFORCE_ENDPOINT: "" }],
	])("warns that sending is not configured with %s", async (_name, env) => {
		const { run, sent } = setup({ env });
		const result = await run();
		expect(result.code).toBe(0);
		expect(sent).toEqual([]);
		expect(result.err).toContain(NOT_CONFIGURED);
		expect(JSON.parse(result.out)).toEqual(warned(NOT_CONFIGURED));
	});

	it("warns about an endpoint that is set but not allowed", async () => {
		const { run, sent } = setup({
			env: { HARNESSFORCE_ENDPOINT: "http://ingest.example.test" },
		});
		const result = await run();
		expect(sent).toEqual([]);
		expect(JSON.parse(result.out)).toEqual(warned(INVALID_ENDPOINT));
	});

	it.each(["resume", "compact"])(
		"does not warn on source %s even when sending is not configured",
		async (source) => {
			const { run } = setup({
				env: { HARNESSFORCE_WORKSPACE_ID: "", HARNESSFORCE_ENDPOINT: "" },
				input: { session_id: "sess-1", cwd: "/work/web", source },
			});
			const result = await run();
			expect(JSON.parse(result.out)).toEqual(context("sess-1"));
		},
	);

	it("never sends the key to a destination other than the origin pinned by init", async () => {
		const { run, sent } = setup({
			env: { HARNESSFORCE_ENDPOINT: "https://elsewhere.example.test/base" },
		});
		const result = await run();
		expect(sent).toEqual([]);
		expect(result.code).toBe(0);
		expect(result.err).not.toContain(KEY);
		expect(JSON.parse(result.out)).toEqual(warned(DESTINATION_MISMATCH));
	});

	it.each([
		["no key", { items: {} }, KEY_MISSING],
		[
			"an unavailable keychain",
			{
				available: false,
				items: {
					[ingestKeyAccount(WORKSPACE)]: KEY,
					[ingestOriginAccount(WORKSPACE)]: "https://ingest.example.test",
				},
			},
			KEY_UNREADABLE,
		],
		[
			"a key without the origin pinned by init",
			{ items: { [ingestKeyAccount(WORKSPACE)]: KEY } },
			DESTINATION_MISMATCH,
		],
		["a failing keychain", { failRead: true }, KEY_UNREADABLE],
	])(
		"sends nothing, exits 0 and warns with %s",
		async (_name, keychain, message) => {
			const { run, sent } = setup({ keychain });
			const result = await run();
			expect(sent).toEqual([]);
			expect(result.code).toBe(0);
			expect(JSON.parse(result.out)).toEqual(warned(message));
		},
	);

	it("bounds the keychain read by 1 second and warns that a slower read could not read the key", async () => {
		const { keychain, timeouts } = fakeKeychain();
		const hanging = { ...keychain, get: () => new Promise<never>(() => {}) };
		keychain.withTimeout = (ms) => {
			timeouts.push(ms);
			return hanging;
		};
		const sent: unknown[] = [];
		const started = Date.now();
		const result = await runCli(["hook", "session-start"], {
			homeDir: tempDir("hf-hook-home-"),
			env: {
				HARNESSFORCE_WORKSPACE_ID: WORKSPACE,
				HARNESSFORCE_ENDPOINT: ENDPOINT,
			},
			keychain,
			now: () => NOW,
			hookGit: gitRepo as never,
			readStdin: async () =>
				Buffer.from(
					JSON.stringify({
						session_id: "sess-1",
						cwd: "/work/web",
						source: "startup",
					}),
				),
			fetch: async (url) => {
				sent.push(url);
				return new Response(null, { status: 202 });
			},
		});
		expect(Date.now() - started).toBeLessThan(3_000);
		expect(timeouts).toEqual([1_000]);
		expect(sent).toEqual([]);
		expect(result.code).toBe(0);
		expect(JSON.parse(result.out)).toEqual(warned(KEY_UNREADABLE));
	});

	it("sends nothing outside a git repository", async () => {
		const { run, sent } = setup({ git: async () => undefined });
		const result = await run();
		expect(sent).toEqual([]);
		expect(JSON.parse(result.out)).toEqual(context("sess-1"));
	});

	it("on 401 writes the revoked-key message to stderr and as the systemMessage", async () => {
		const { run } = setup({ status: 401 });
		const result = await run();
		expect(result.code).toBe(0);
		expect(result.err).toContain(REVOKED);
		expect(JSON.parse(result.out)).toEqual(warned(REVOKED));
	});

	it("exits 0 and warns about the failed registration when the network is down", async () => {
		const { run } = setup({ fetchFails: true });
		const result = await run();
		expect(result.code).toBe(0);
		expect(JSON.parse(result.out)).toEqual(warned(REGISTRATION_FAILED));
	});

	it.each([400, 500, 503])(
		"warns about the failed registration on HTTP %i",
		async (status) => {
			const { run } = setup({ status });
			const result = await run();
			expect(result.code).toBe(0);
			expect(JSON.parse(result.out)).toEqual(warned(REGISTRATION_FAILED));
		},
	);

	it("exits 0 with no output for an input it cannot use", async () => {
		for (const input of [
			"not json",
			{ cwd: "/work/web" },
			{ session_id: "sess-1" },
			{ session_id: "sess-1", cwd: "relative/dir" },
			{ session_id: "has space", cwd: "/work/web" },
		]) {
			const { run, sent } = setup({ input });
			const result = await run();
			expect(result.code).toBe(0);
			expect(result.out).toBe("");
			expect(sent).toEqual([]);
		}
	});

	it("rejects an unknown event or extra arguments with the usage", async () => {
		const { run } = setup();
		for (const args of [
			["hook"],
			["hook", "stop"],
			["hook", "session-start", "x"],
		]) {
			const result = await run(args);
			expect(result.code).toBe(1);
			expect(result.err).toContain("harnessforce hook session-start");
		}
	});
});
