import { describe, expect, it } from "vitest";
import {
	buildLaunch,
	isClaudeCode,
	isCodex,
	resourceAttributes,
} from "../../src/run/launch.js";

const target = {
	workspaceId: "ws1",
	ingestEndpoint: "https://ingest.example.test/base",
	platform: "linux" as NodeJS.Platform,
};

describe("resourceAttributes", () => {
	it("percent-encodes every value in the documented order", () =>
		expect(
			resourceAttributes(
				{
					issueIdentifier: "#45",
					repository: "github.com/acme/web",
					branch: "feat/a b,c=d",
					commit: "abc123",
					configVersion: "f".repeat(64),
				},
				undefined,
			),
		).toBe(
			[
				"hf.issue.identifier=%2345",
				"hf.vcs.repository=github.com%2Facme%2Fweb",
				"hf.vcs.branch=feat%2Fa%20b%2Cc%3Dd",
				"hf.vcs.commit=abc123",
				`hf.agent.config_version=${"f".repeat(64)}`,
			].join(","),
		));

	it("omits values that are not known", () =>
		expect(resourceAttributes({ issueIdentifier: "ENG-1" }, undefined)).toBe(
			"hf.issue.identifier=ENG-1",
		));

	it("keeps the shell's attributes except hf.* ones", () =>
		expect(
			resourceAttributes(
				{ issueIdentifier: "ENG-1" },
				"team=web, hf.issue.identifier=OLD ,department=eng%20a,",
			),
		).toBe("team=web,department=eng%20a,hf.issue.identifier=ENG-1"));
});

describe("isClaudeCode", () => {
	it.each([
		["claude", true],
		["/usr/local/bin/claude", true],
		["C:\\Tools\\claude.exe", true],
		["claude.cmd", true],
		["codex", false],
		["claude-dev", false],
	])("%s → %s", (agent, expected) =>
		expect(isClaudeCode(agent)).toBe(expected));
});

// correlation.md「`harnessforce run -- codex`」手順4: basenameが`codex`、`codex.exe`、`codex.cmd`のagent。
describe("isCodex", () => {
	it.each([
		["codex", true],
		["/usr/local/bin/codex", true],
		["C:\\Tools\\codex.exe", true],
		["codex.cmd", true],
		["CODEX.CMD", true],
		["claude", false],
		["codex-dev", false],
		["my-codex", false],
		["codex.sh", false],
	])("%s → %s", (agent, expected) => expect(isCodex(agent)).toBe(expected));
});

describe("buildLaunch", () => {
	const attributes = "hf.issue.identifier=ENG-1";
	const stepThree = {
		HARNESSFORCE_WORKSPACE_ID: "ws1",
		HARNESSFORCE_ENDPOINT: "https://ingest.example.test/base",
		OTEL_EXPORTER_OTLP_ENDPOINT: "https://ingest.example.test/base",
		OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
		CLAUDE_CODE_ENABLE_TELEMETRY: "1",
		CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
		OTEL_RESOURCE_ATTRIBUTES: attributes,
		HARNESSFORCE_ISSUE: "ENG-1",
	};

	it("sets only the destination, telemetry and HARNESSFORCE_ISSUE, never a key or headers", () => {
		const launch = buildLaunch({
			agent: "claude",
			args: ["--flag"],
			issueIdentifier: "ENG-1",
			resourceAttributes: attributes,
			shellEnv: { PATH: "/bin", HARNESSFORCE_WORKSPACE_ID: "other" },
			...target,
		});
		expect(launch).toEqual({
			command: "claude",
			args: ["--flag"],
			env: { PATH: "/bin", ...stepThree },
			settingsEnv: stepThree,
		});
		expect(launch.env).not.toHaveProperty("OTEL_EXPORTER_OTLP_HEADERS");
	});

	// 他の送信先の資格情報を送らず、signal別の送信先とprotocolでhelperの確認とheaderを外させない。
	it("strips inherited OTLP headers and per-signal endpoints and protocols", () => {
		const inherited = Object.fromEntries(
			[
				"OTEL_EXPORTER_OTLP_HEADERS",
				...["TRACES", "LOGS", "METRICS"].flatMap((signal) => [
					`OTEL_EXPORTER_OTLP_${signal}_HEADERS`,
					`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`,
					`OTEL_EXPORTER_OTLP_${signal}_PROTOCOL`,
				]),
			].map((name) => [name, "x"]),
		);
		const launch = buildLaunch({
			agent: "claude",
			args: [],
			issueIdentifier: "ENG-1",
			resourceAttributes: attributes,
			shellEnv: {
				...inherited,
				OTEL_EXPORTER_OTLP_PROTOCOL: "grpc",
				OTEL_METRICS_EXPORTER: "otlp",
				HOME: "/home/u",
			},
			...target,
		});
		expect(launch.env).toEqual({
			...stepThree,
			OTEL_METRICS_EXPORTER: "otlp",
			HOME: "/home/u",
		});
	});

	// Windowsの環境変数の名前は大文字と小文字を区別しない。
	it("strips and overrides names regardless of case on Windows only", () => {
		const shellEnv = {
			otel_exporter_otlp_headers: "Authorization=Bearer other",
			Harnessforce_Workspace_Id: "other",
		};
		const windows = buildLaunch({
			agent: "claude",
			args: [],
			issueIdentifier: "ENG-1",
			resourceAttributes: attributes,
			shellEnv,
			...target,
			platform: "win32",
		});
		expect(windows.env).toEqual(stepThree);
		const linux = buildLaunch({
			agent: "claude",
			args: [],
			issueIdentifier: "ENG-1",
			resourceAttributes: attributes,
			shellEnv,
			...target,
		});
		expect(linux.env).toEqual({ ...shellEnv, ...stepThree });
	});

	it("gives Claude Code the same values as a settings env, outside its args", () => {
		const launch = buildLaunch({
			agent: "claude",
			args: ["-p", "hi"],
			issueIdentifier: "ENG-1",
			resourceAttributes: attributes,
			shellEnv: {},
			...target,
		});
		expect(launch.args).toEqual(["-p", "hi"]);
		expect(launch.settingsEnv).toEqual(stepThree);
	});

	it("gives other agents no settings", () =>
		expect(
			buildLaunch({
				agent: "aider",
				args: [],
				issueIdentifier: "ENG-1",
				resourceAttributes: attributes,
				shellEnv: {},
				...target,
			}).settingsEnv,
		).toBeUndefined());

	it("does not enable prompt or body logging", () => {
		const launch = buildLaunch({
			agent: "claude",
			args: [],
			issueIdentifier: "ENG-1",
			resourceAttributes: attributes,
			shellEnv: {},
			...target,
		});
		expect(Object.keys(launch.env)).not.toContain("OTEL_LOG_USER_PROMPTS");
		expect(JSON.stringify(launch.settingsEnv)).not.toContain("OTEL_LOG_");
	});
});

// correlation.md「`harnessforce run -- codex`」手順3と5: CodexはHARNESSFORCE_*の3つだけを受け取る。
// CodexはCLAUDE_CODE_*とOTEL_RESOURCE_ATTRIBUTESを読まず、OTEL_EXPORTER_OTLP_ENDPOINTを設定すると
// [otel]のexporterのendpointの代わりに使われ、headerが付かないおそれがある。
describe("buildLaunch for Codex", () => {
	const codexEnv = {
		HARNESSFORCE_WORKSPACE_ID: "ws1",
		HARNESSFORCE_ENDPOINT: "https://ingest.example.test/base",
		HARNESSFORCE_ISSUE: "ENG-1",
	};
	const request = (overrides: object = {}) => ({
		agent: "codex",
		args: ["exec", "--flag"],
		issueIdentifier: "ENG-1",
		resourceAttributes: "hf.issue.identifier=ENG-1",
		shellEnv: { PATH: "/bin" },
		...target,
		...overrides,
	});

	it("sets only the three HARNESSFORCE variables, never an OTLP, Claude Code or resource variable", () => {
		const launch = buildLaunch(request());
		expect(launch).toEqual({
			command: "codex",
			args: ["exec", "--flag"],
			env: { PATH: "/bin", ...codexEnv },
		});
		for (const name of [
			"OTEL_EXPORTER_OTLP_ENDPOINT",
			"OTEL_EXPORTER_OTLP_PROTOCOL",
			"OTEL_EXPORTER_OTLP_HEADERS",
			"OTEL_RESOURCE_ATTRIBUTES",
			"CLAUDE_CODE_ENABLE_TELEMETRY",
			"CLAUDE_CODE_ENHANCED_TELEMETRY_BETA",
		])
			expect(launch.env).not.toHaveProperty(name);
	});

	it("passes no settings file, for every spelling of the command", () => {
		for (const agent of ["codex", "/opt/bin/codex", "codex.exe", "codex.cmd"])
			expect(buildLaunch(request({ agent })).settingsEnv).toBeUndefined();
	});

	it("overrides the shell's HARNESSFORCE variables and leaves its other variables alone", () => {
		const launch = buildLaunch(
			request({
				shellEnv: {
					PATH: "/bin",
					HARNESSFORCE_WORKSPACE_ID: "other",
					HARNESSFORCE_ISSUE: "OLD-1",
					OTEL_METRICS_EXPORTER: "otlp",
				},
			}),
		);
		expect(launch.env).toEqual({
			PATH: "/bin",
			OTEL_METRICS_EXPORTER: "otlp",
			...codexEnv,
		});
	});

	it("overrides the HARNESSFORCE variables regardless of case on Windows only", () => {
		const shellEnv = { Harnessforce_Workspace_Id: "other", Path: "C:\\bin" };
		expect(buildLaunch(request({ shellEnv, platform: "win32" })).env).toEqual({
			Path: "C:\\bin",
			...codexEnv,
		});
		expect(buildLaunch(request({ shellEnv })).env).toEqual({
			...shellEnv,
			...codexEnv,
		});
	});
});
