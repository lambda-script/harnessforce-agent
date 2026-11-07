import {
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { storedToken } from "@harnessforce/test-support/api-token";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { describe, expect, it } from "vitest";
import type { CliDeps } from "../../src/main.js";
import {
	initializedHome,
	initializedKeychain,
	startImportServer,
	TOKEN_EXPIRY,
} from "../import/harness.js";
import { fakeKeychain, runCli, untouchableKeychain } from "../support/cli.js";

const NOW = Date.parse("2026-09-27T00:00:00Z");
const USAGE =
	"Usage: harnessforce config get send-content, or harnessforce config set send-content on|off\n";
const OFF =
	"Content is no longer sent from this machine. Restart Claude Code and Codex to apply\n";
const MANAGED =
	"Your organization's managed settings also set whether content is sent, and they override this machine's setting. Ask your administrator to change them\n";
const SAVED_FOR_LOGIN =
	"Saved. Content will be sent after you run `harnessforce login`\n";
const RESTART = "Restart Claude Code and Codex to apply\n";
const NOT_READ =
	"Saved, but the workspace settings could not be read, so content is not sent yet. Run `harnessforce config set send-content on` again\n";
const UNREADABLE_GET =
	"Cannot read the device settings (`~/.harnessforce/config.json`), so content is not sent\n";
const UNREADABLE_SET =
	"Cannot read the device settings (`~/.harnessforce/config.json`), so the setting was not changed\n";

const CONTENT_ON = {
	OTEL_LOG_USER_PROMPTS: "1",
	OTEL_LOG_ASSISTANT_RESPONSES: "1",
	OTEL_LOG_TOOL_DETAILS: "1",
	OTEL_LOG_TOOL_CONTENT: "1",
};
const CONTENT_OFF = {
	OTEL_LOG_USER_PROMPTS: "0",
	OTEL_LOG_ASSISTANT_RESPONSES: "0",
	OTEL_LOG_TOOL_DETAILS: "0",
	OTEL_LOG_TOOL_CONTENT: "0",
};
const CODEX_ON = `model = "o3"

[otel]
environment = "dev"
log_user_prompt = true
log_agent_responses = true
`;
const codexWith = (prompt: boolean, agent: boolean) =>
	CODEX_ON.replace(
		"log_user_prompt = true",
		`log_user_prompt = ${prompt}`,
	).replace("log_agent_responses = true", `log_agent_responses = ${agent}`);

const devicePath = (home: string) => join(home, ".harnessforce", "config.json");
const settingsPath = (home: string) => join(home, ".claude", "settings.json");
const codexPath = (home: string) => join(home, ".codex", "config.toml");

function writeFile(path: string, text: string) {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, text);
}
const readText = (path: string) =>
	existsSync(path) ? readFileSync(path, "utf8") : undefined;
const readJson = (path: string) => JSON.parse(readText(path) ?? "null");

// 通信してはいけないtestで使う。
const noNetwork = async (): Promise<Response> => {
	throw new Error("must not send");
};

const runConfig = (args: string[], deps: Partial<CliDeps> = {}) =>
	runCli(["config", ...args], {
		now: () => new Date(NOW),
		fetch: noNetwork,
		...deps,
	});

describe("harnessforce config get send-content", () => {
	it.each([
		["no file", undefined, "off"],
		["no send_content key", { insights: { send_report: false } }, "off"],
		["send_content true", { send_content: true }, "on"],
		["send_content false", { send_content: false }, "off"],
	])("prints the setting for %s", async (_name, device, value) => {
		const home = tempDir("hf-home-");
		if (device) writeFile(devicePath(home), JSON.stringify(device));
		expect(
			await runConfig(["get", "send-content"], {
				homeDir: home,
				keychain: untouchableKeychain,
			}),
		).toEqual({ code: 0, out: `${value}\n`, err: "" });
	});

	it.each([
		["not JSON", "{"],
		["an array", "[]"],
		[
			"a send_content that is not a boolean",
			JSON.stringify({ send_content: 1 }),
		],
	])("refuses a device settings file with %s", async (_name, text) => {
		const home = tempDir("hf-home-");
		writeFile(devicePath(home), text);
		expect(await runConfig(["get", "send-content"], { homeDir: home })).toEqual(
			{
				code: 1,
				out: "",
				err: UNREADABLE_GET,
			},
		);
	});
});

describe("harnessforce config set send-content off", () => {
	it("rewrites the content settings that are present without the keychain or network", async () => {
		const { home } = initializedHome({ ...CONTENT_ON, OTHER: "1" });
		writeFile(
			devicePath(home),
			JSON.stringify({ send_content: true, top: {} }),
		);
		writeFile(codexPath(home), CODEX_ON);

		const r = await runConfig(["set", "send-content", "off"], {
			homeDir: home,
			keychain: untouchableKeychain,
		});

		expect(r).toEqual({ code: 0, out: OFF, err: "" });
		expect(readJson(devicePath(home))).toEqual({
			send_content: false,
			top: {},
		});
		expect(readJson(settingsPath(home))).toEqual({
			env: { ...CONTENT_OFF, OTHER: "1" },
		});
		expect(readText(codexPath(home))).toBe(codexWith(false, false));
		// WindowsはPOSIXのpermission bitを持たない。
		if (process.platform !== "win32") {
			expect(statSync(devicePath(home)).mode & 0o777).toBe(0o600);
			expect(statSync(join(home, ".harnessforce")).mode & 0o777).toBe(0o700);
		}
	});

	it("adds no variable or value that was not there", async () => {
		const { home } = initializedHome({ OTEL_LOG_USER_PROMPTS: "1" });
		writeFile(codexPath(home), 'model = "o3"\n');

		const r = await runConfig(["set", "send-content", "off"], {
			homeDir: home,
		});

		expect(r.code).toBe(0);
		expect(readJson(settingsPath(home))).toEqual({
			env: { OTEL_LOG_USER_PROMPTS: "0" },
		});
		expect(readText(codexPath(home))).toBe('model = "o3"\n');
	});

	it("creates neither the user settings nor the Codex configuration", async () => {
		const home = tempDir("hf-home-");
		const r = await runConfig(["set", "send-content", "off"], {
			homeDir: home,
		});
		expect(r).toEqual({ code: 0, out: OFF, err: "" });
		expect(readJson(devicePath(home))).toEqual({ send_content: false });
		expect(existsSync(settingsPath(home))).toBe(false);
		expect(existsSync(codexPath(home))).toBe(false);
	});

	it("names managed settings that also set content", async () => {
		const { home } = initializedHome(CONTENT_ON);
		const managed = tempDir("hf-managed-");
		writeFile(
			join(managed, "managed-settings.json"),
			JSON.stringify({ env: { OTEL_LOG_TOOL_CONTENT: "1" } }),
		);

		const r = await runConfig(["set", "send-content", "off"], {
			homeDir: home,
			managedDir: managed,
		});

		expect(r).toEqual({ code: 0, out: OFF + MANAGED, err: "" });
	});

	it.each([
		["not JSON", "{"],
		["an array", "[]"],
	])(
		"keeps a device settings file that is %s and changes nothing",
		async (_name, text) => {
			const { home } = initializedHome(CONTENT_ON);
			writeFile(devicePath(home), text);

			const r = await runConfig(["set", "send-content", "off"], {
				homeDir: home,
			});

			expect(r).toEqual({ code: 1, out: "", err: UNREADABLE_SET });
			expect(readText(devicePath(home))).toBe(text);
			expect(readJson(settingsPath(home))).toEqual({ env: CONTENT_ON });
		},
	);

	it("names the user settings it could not write and keeps the saved setting", async () => {
		const home = tempDir("hf-home-");
		writeFile(settingsPath(home), "{");

		const r = await runConfig(["set", "send-content", "off"], {
			homeDir: home,
		});

		expect(r).toEqual({
			code: 1,
			out: "",
			err: "Could not write the Claude Code user settings. Run `harnessforce config set send-content off` again\n",
		});
		expect(readJson(devicePath(home))).toEqual({ send_content: false });
	});

	it("names the Codex configuration it could not write", async () => {
		const { home } = initializedHome(CONTENT_ON);
		writeFile(codexPath(home), "[otel");

		const r = await runConfig(["set", "send-content", "off"], {
			homeDir: home,
		});

		expect(r).toEqual({
			code: 1,
			out: "",
			err: "Could not write the Codex configuration. Run `harnessforce config set send-content off` again\n",
		});
	});
});

describe("harnessforce config set send-content on", () => {
	it.each([
		["no workspace in the user settings", {}, () => fakeKeychain()],
		[
			"no ingest key in the keychain",
			{ HARNESSFORCE_WORKSPACE_ID: "ws1" },
			() => fakeKeychain(),
		],
		[
			"an unavailable keychain",
			{ HARNESSFORCE_WORKSPACE_ID: "ws1" },
			() => fakeKeychain({ available: false }),
		],
	])(
		"saves the setting for the next login with %s",
		async (_name, env, keychain) => {
			const { home } = initializedHome({ ...env, ...CONTENT_OFF });
			writeFile(codexPath(home), codexWith(false, false));

			const r = await runConfig(["set", "send-content", "on"], {
				homeDir: home,
				keychain: keychain().keychain,
			});

			expect(r).toEqual({ code: 0, out: SAVED_FOR_LOGIN, err: "" });
			expect(readJson(devicePath(home))).toEqual({ send_content: true });
			expect(readJson(settingsPath(home))).toEqual({
				env: { ...env, ...CONTENT_OFF },
			});
			expect(readText(codexPath(home))).toBe(codexWith(false, false));
		},
	);

	it("applies the categories the workspace stores", async () => {
		const server = await startImportServer({
			workspace: {
				status: 200,
				body: {
					session_import_days: 30,
					content: {
						prompts: true,
						model_and_tools: false,
						visibility: "sender_only",
						retention_days: 14,
					},
				},
			},
		});
		const { home } = initializedHome({
			HARNESSFORCE_URL: server.appUrl,
			HARNESSFORCE_ENDPOINT: server.ingestUrl,
			HARNESSFORCE_WORKSPACE_ID: "ws1",
			OTHER: "kept",
		});
		writeFile(codexPath(home), codexWith(false, false));

		const r = await runConfig(["set", "send-content", "on"], {
			homeDir: home,
			keychain: initializedKeychain(server.origin).keychain,
			fetch: (url, init) => fetch(url, init),
		});

		expect(r).toEqual({
			code: 0,
			out:
				"Sending the prompts you type is now enabled. Values that match known patterns for secrets and personal information are masked, but not everything can be detected. Within the workspace, only you can read it. It is deleted after 14 days\n" +
				RESTART,
			err: "",
		});
		expect(server.requests.map((q) => q.path)).toEqual([
			"GET /app/api/v1/workspace",
		]);
		expect(server.requests[0]?.headers.authorization).toBe(
			"Bearer hf_at_ws1_current",
		);
		expect(readJson(settingsPath(home)).env).toEqual({
			HARNESSFORCE_URL: server.appUrl,
			HARNESSFORCE_ENDPOINT: server.ingestUrl,
			HARNESSFORCE_WORKSPACE_ID: "ws1",
			OTHER: "kept",
			OTEL_LOG_USER_PROMPTS: "1",
			OTEL_LOG_ASSISTANT_RESPONSES: "0",
			OTEL_LOG_TOOL_DETAILS: "0",
			OTEL_LOG_TOOL_CONTENT: "0",
		});
		expect(readText(codexPath(home))).toBe(codexWith(true, false));
		expect(readJson(devicePath(home))).toEqual({ send_content: true });
	});

	it("writes every variable as 0 when the workspace stores no content", async () => {
		const server = await startImportServer({
			workspace: {
				status: 200,
				body: {
					session_import_days: 30,
					content: {
						prompts: false,
						model_and_tools: false,
						visibility: "all_members",
						retention_days: 30,
					},
				},
			},
		});
		const { home } = initializedHome({
			HARNESSFORCE_URL: server.appUrl,
			HARNESSFORCE_ENDPOINT: server.ingestUrl,
			HARNESSFORCE_WORKSPACE_ID: "ws1",
		});
		const managed = tempDir("hf-managed-");
		writeFile(
			join(managed, "managed-settings.json"),
			JSON.stringify({ env: { OTEL_LOG_USER_PROMPTS: "1" } }),
		);

		const r = await runConfig(["set", "send-content", "on"], {
			homeDir: home,
			managedDir: managed,
			keychain: initializedKeychain(server.origin).keychain,
			fetch: (url, init) => fetch(url, init),
		});

		expect(r).toEqual({
			code: 0,
			out:
				"This workspace does not store content, so sending content was not enabled. An owner or admin can turn it on under Collection & retention in the workspace settings, then run `harnessforce config set send-content on` again\n" +
				RESTART +
				MANAGED,
			err: "",
		});
		expect(readJson(settingsPath(home)).env).toMatchObject(CONTENT_OFF);
		// Codexの`config.toml`が無ければ書かない。
		expect(existsSync(codexPath(home))).toBe(false);
	});

	it.each([
		["a 500", { status: 500 }],
		["no content", { status: 200, body: { session_import_days: 30 } }],
		[
			"a retention the CLI does not know",
			{
				status: 200,
				body: {
					session_import_days: 30,
					content: {
						prompts: true,
						model_and_tools: true,
						visibility: "all_members",
						retention_days: 90,
					},
				},
			},
		],
	])(
		"keeps the saved on and the settings when the workspace returns %s",
		async (_name, reply) => {
			const server = await startImportServer({ workspace: reply });
			const env = {
				HARNESSFORCE_URL: server.appUrl,
				HARNESSFORCE_ENDPOINT: server.ingestUrl,
				HARNESSFORCE_WORKSPACE_ID: "ws1",
				...CONTENT_OFF,
			};
			const { home } = initializedHome(env);

			const r = await runConfig(["set", "send-content", "on"], {
				homeDir: home,
				keychain: initializedKeychain(server.origin).keychain,
				fetch: (url, init) => fetch(url, init),
			});

			expect(r).toEqual({ code: 1, out: "", err: NOT_READ });
			expect(readJson(devicePath(home))).toEqual({ send_content: true });
			expect(readJson(settingsPath(home))).toEqual({ env });
		},
	);

	it("names the expired login before the saved on", async () => {
		const server = await startImportServer({
			unauthorizedTokens: ["hf_at_ws1_current"],
			refresh: { status: 400, body: { error: "invalid_grant" } },
		});
		const { home } = initializedHome({
			HARNESSFORCE_URL: server.appUrl,
			HARNESSFORCE_ENDPOINT: server.ingestUrl,
			HARNESSFORCE_WORKSPACE_ID: "ws1",
		});

		const r = await runConfig(["set", "send-content", "on"], {
			homeDir: home,
			keychain: initializedKeychain(server.origin).keychain,
			fetch: (url, init) => fetch(url, init),
		});

		expect(r).toEqual({
			code: 1,
			out: "",
			err: `Your login has expired. Run \`harnessforce login\`\n${NOT_READ}`,
		});
	});

	it("names a destination other than the one login saved before the saved on", async () => {
		const server = await startImportServer();
		const { home } = initializedHome({
			HARNESSFORCE_URL: "https://elsewhere.example.test",
			HARNESSFORCE_ENDPOINT: server.ingestUrl,
			HARNESSFORCE_WORKSPACE_ID: "ws1",
		});

		const r = await runConfig(["set", "send-content", "on"], {
			homeDir: home,
			keychain: initializedKeychain(server.origin).keychain,
			fetch: noNetwork,
		});

		expect(r).toEqual({
			code: 1,
			out: "",
			err: `The Harnessforce destination differs from the one saved by \`harnessforce login\`. Run \`harnessforce login\` again\n${NOT_READ}`,
		});
		expect(readJson(devicePath(home))).toEqual({ send_content: true });
	});

	it("uses the workspace from the environment first", async () => {
		const server = await startImportServer();
		const { home } = initializedHome({
			HARNESSFORCE_URL: server.appUrl,
			HARNESSFORCE_ENDPOINT: server.ingestUrl,
			HARNESSFORCE_WORKSPACE_ID: "ws1",
		});

		const r = await runConfig(["set", "send-content", "on"], {
			homeDir: home,
			env: { HARNESSFORCE_WORKSPACE_ID: "ws2" },
			keychain: fakeKeychain({
				items: {
					"ws1:ingest-key": "hf_ik_ws1_user",
					"ws1:api-token": storedToken("ws1", "current", TOKEN_EXPIRY),
				},
			}).keychain,
		});

		expect(r).toEqual({ code: 0, out: SAVED_FOR_LOGIN, err: "" });
	});
});

describe("harnessforce config with bad arguments", () => {
	it.each([
		[[]],
		[["get"]],
		[["get", "color"]],
		[["get", "send-content", "on"]],
		[["set", "send-content"]],
		[["set", "send-content", "yes"]],
		[["set", "color", "on"]],
		[["set", "send-content", "on", "off"]],
		[["list"]],
	])("changes nothing for %j", async (args) => {
		const home = tempDir("hf-home-");
		const r = await runConfig(args, {
			homeDir: home,
			keychain: untouchableKeychain,
		});
		expect(r).toEqual({ code: 2, out: "", err: USAGE });
		expect(existsSync(devicePath(home))).toBe(false);
	});
});
