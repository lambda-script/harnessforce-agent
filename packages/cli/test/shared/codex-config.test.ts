import {
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parse } from "@decimalturn/toml-patch";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { describe, expect, it } from "vitest";
import {
	codexConfigPath,
	mergeCodexConfig,
	readCodexConfig,
	writeCodexConfig,
} from "../../src/shared/codex-config.js";

// 検証する値だけを読むため、形は緩く扱う。
// biome-ignore lint/suspicious/noExplicitAny: parserが返す任意の形のtableを深く辿る。
type Config = Record<string, any>;

const input = {
	connection: "https://hf.example.test",
	ingestEndpoint: "https://ingest.example.test/base",
	ingestKey: "hf_ik_ws1_new",
	logUserPrompt: false,
};

const EXPORTER = {
	"otlp-http": {
		endpoint: "https://ingest.example.test/base",
		headers: { Authorization: "Bearer hf_ik_ws1_new" },
		protocol: "binary",
	},
};
const HANDLER = {
	type: "command",
	command: "harnessforce hook session-start",
	commandWindows: "harnessforce.cmd hook session-start",
	timeout: 10,
};

const merged = (text: string, overrides: Partial<typeof input> = {}) =>
	parse(mergeCodexConfig(text, { ...input, ...overrides })) as Config;

describe("Codex config.toml path", () => {
	it("lives in ~/.codex unless CODEX_HOME is an absolute path", () => {
		expect(codexConfigPath({}, "/home/u")).toBe(
			join("/home/u", ".codex", "config.toml"),
		);
		expect(codexConfigPath({ CODEX_HOME: "/cx" }, "/home/u")).toBe(
			join("/cx", "config.toml"),
		);
		expect(codexConfigPath({ CODEX_HOME: "cx" }, "/home/u")).toBe(
			join("/home/u", ".codex", "config.toml"),
		);
	});
});

describe("merging the harnessforce items into config.toml", () => {
	it("writes the three items into an empty file", () => {
		expect(merged("")).toEqual({
			otel: { exporter: EXPORTER },
			hooks: { SessionStart: [{ hooks: [HANDLER] }] },
			mcp_servers: { harnessforce: { url: "https://hf.example.test/mcp" } },
		});
	});

	it("leaves every other key, table and comment alone", () => {
		const text = `# my codex
model = "gpt-5"

[otel]
environment = "prod" # keep
log_user_prompt = false
metrics_exporter = "none"

[hooks.Stop]
x = 1

[[hooks.SessionStart]]
matcher = "startup"
[[hooks.SessionStart.hooks]]
type = "command"
command = "other"

[mcp_servers.other]
url = "https://o.example.test"

[tui]
theme = "dark"
`;
		const result = mergeCodexConfig(text, input);
		expect(result).toContain("# my codex");
		expect(result).toContain('environment = "prod" # keep');
		const config = parse(result) as Config;
		expect(config.model).toBe("gpt-5");
		expect(config.tui).toEqual({ theme: "dark" });
		expect(config.hooks.Stop).toEqual({ x: 1 });
		expect(config.otel).toEqual({
			environment: "prod",
			log_user_prompt: false,
			metrics_exporter: "none",
			exporter: EXPORTER,
		});
		expect(config.hooks.SessionStart).toEqual([
			{
				matcher: "startup",
				hooks: [{ type: "command", command: "other" }],
			},
			{ hooks: [HANDLER] },
		]);
		expect(config.mcp_servers).toEqual({
			other: { url: "https://o.example.test" },
			harnessforce: { url: "https://hf.example.test/mcp" },
		});
	});

	it("replaces only the previously written items on a re-run", () => {
		const first = mergeCodexConfig('[otel]\nenvironment = "prod"\n', input);
		const second = mergeCodexConfig(first, {
			...input,
			connection: "https://other.example.test",
			ingestEndpoint: "https://ingest2.example.test",
			ingestKey: "hf_ik_ws1_newer",
		});
		const config = parse(second) as Config;
		expect(config.otel).toEqual({
			environment: "prod",
			exporter: {
				"otlp-http": {
					endpoint: "https://ingest2.example.test",
					headers: { Authorization: "Bearer hf_ik_ws1_newer" },
					protocol: "binary",
				},
			},
		});
		expect(config.hooks.SessionStart).toEqual([{ hooks: [HANDLER] }]);
		expect(config.mcp_servers).toEqual({
			harnessforce: { url: "https://other.example.test/mcp" },
		});
		expect(second).not.toContain('hf_ik_ws1_new"');
		expect(
			second.match(/hooks\.SessionStart/g)?.length ?? 0,
		).toBeLessThanOrEqual(2);
	});

	it("keeps a matcher and other handlers of the group it wrote before", () => {
		const text = `[[hooks.SessionStart]]
matcher = "startup"
[[hooks.SessionStart.hooks]]
type = "command"
command = "harnessforce hook session-start"
timeout = 600
[[hooks.SessionStart.hooks]]
type = "command"
command = "mine"
`;
		expect(merged(text).hooks.SessionStart).toEqual([
			{
				matcher: "startup",
				hooks: [HANDLER, { type: "command", command: "mine" }],
			},
		]);
	});

	it("refreshes every harnessforce handler in place without adding groups", () => {
		const handler = `[[hooks.SessionStart]]
[[hooks.SessionStart.hooks]]
type = "command"
command = "harnessforce hook session-start"
timeout = 600
`;
		expect(merged(handler + handler).hooks.SessionStart).toEqual([
			{ hooks: [HANDLER] },
			{ hooks: [HANDLER] },
		]);
	});

	it("keeps the other keys of an existing harnessforce MCP server", () => {
		const text = `[mcp_servers.harnessforce]
url = "https://old.example.test/mcp"
startup_timeout_sec = 30
`;
		expect(merged(text).mcp_servers.harnessforce).toEqual({
			url: "https://hf.example.test/mcp",
			startup_timeout_sec: 30,
		});
	});

	it("sets log_user_prompt only when asked, and never clears it", () => {
		expect(merged("", { logUserPrompt: true }).otel.log_user_prompt).toBe(true);
		expect(merged("").otel.log_user_prompt).toBeUndefined();
		expect(
			merged("[otel]\nlog_user_prompt = true\n").otel.log_user_prompt,
		).toBe(true);
	});

	it("does not set log_agent_responses or log_guardian_assessments", () => {
		const { otel } = merged("", { logUserPrompt: true });
		expect(otel.log_agent_responses).toBeUndefined();
		expect(otel.log_guardian_assessments).toBeUndefined();
	});

	it.each([
		["not TOML", "[otel"],
		["otel is not a table", 'otel = "x"\n'],
		["hooks is not a table", "hooks = 1\n"],
		["SessionStart is not an array", "[hooks]\nSessionStart = 1\n"],
		["mcp_servers is not a table", "mcp_servers = []\n"],
	])("refuses when the file is %s", (_name, text) => {
		expect(() => mergeCodexConfig(text, input)).toThrow();
	});

	it("does not leak file content in the error", () => {
		const secret = "hf_ik_old_secret";
		let message = "";
		try {
			mergeCodexConfig(`token = "${secret}"\n[otel`, input);
		} catch (error) {
			message = String(error);
		}
		expect(message).not.toContain(secret);
	});
});

describe("reading and writing config.toml", () => {
	it("reads a missing file as empty", async () =>
		expect(
			await readCodexConfig(join(tempDir("hf-codex-"), "config.toml")),
		).toBe(""));

	it("writes the file with mode 0600 and creates the directory", async () => {
		const path = join(tempDir("hf-codex-"), "nested", "config.toml");
		await writeCodexConfig(path, "a = 1\n");
		expect(readFileSync(path, "utf8")).toBe("a = 1\n");
		if (process.platform !== "win32")
			expect(statSync(path).mode & 0o777).toBe(0o600);
	});

	it("narrows the mode of an existing wider file to 0600", async () => {
		const path = join(tempDir("hf-codex-"), "config.toml");
		writeFileSync(path, "a = 1\n", { mode: 0o644 });
		await writeCodexConfig(path, "a = 2\n");
		if (process.platform !== "win32")
			expect(statSync(path).mode & 0o777).toBe(0o600);
	});

	it("leaves no temporary file behind when the replacement fails", async () => {
		const dir = tempDir("hf-codex-");
		// renameの宛先がdirectoryだと置き換えに失敗する。
		mkdirSync(join(dir, "config.toml"));
		await expect(
			writeCodexConfig(join(dir, "config.toml"), "a = 1\n"),
		).rejects.toThrow();
		expect(readdirSync(dir)).toEqual(["config.toml"]);
	});
});
