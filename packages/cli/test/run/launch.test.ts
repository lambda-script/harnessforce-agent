import { describe, expect, it } from "vitest";
import {
	buildLaunch,
	isClaudeCode,
	resourceAttributes,
} from "../../src/run/launch.js";

const target = {
	workspaceId: "ws1",
	ingestEndpoint: "https://ingest.example.test/base",
	ingestKey: "hf_ik_ws1_key",
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

describe("buildLaunch", () => {
	const attributes = "hf.issue.identifier=ENG-1";

	it("sets the destination, key, telemetry and HARNESSFORCE_ISSUE in the child environment", () => {
		const launch = buildLaunch({
			agent: "codex",
			args: ["--flag"],
			issueIdentifier: "ENG-1",
			resourceAttributes: attributes,
			shellEnv: { PATH: "/bin", HARNESSFORCE_WORKSPACE_ID: "other" },
			...target,
		});
		expect(launch).toEqual({
			command: "codex",
			args: ["--flag"],
			env: {
				PATH: "/bin",
				HARNESSFORCE_WORKSPACE_ID: "ws1",
				HARNESSFORCE_ENDPOINT: "https://ingest.example.test/base",
				OTEL_EXPORTER_OTLP_ENDPOINT: "https://ingest.example.test/base",
				OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer hf_ik_ws1_key",
				CLAUDE_CODE_ENABLE_TELEMETRY: "1",
				CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
				OTEL_RESOURCE_ATTRIBUTES: attributes,
				HARNESSFORCE_ISSUE: "ENG-1",
			},
		});
	});

	it("passes the same values to Claude Code with --settings before its args", () => {
		const launch = buildLaunch({
			agent: "claude",
			args: ["-p", "hi"],
			issueIdentifier: "ENG-1",
			resourceAttributes: attributes,
			shellEnv: {},
			...target,
		});
		expect(launch.args.slice(2)).toEqual(["-p", "hi"]);
		expect(launch.args[0]).toBe("--settings");
		const settings = JSON.parse(launch.args[1] ?? "");
		expect(Object.keys(settings)).toEqual(["env"]);
		const { HARNESSFORCE_ISSUE, ...stepThree } = launch.env;
		expect(HARNESSFORCE_ISSUE).toBe("ENG-1");
		expect(settings.env).toEqual(stepThree);
	});

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
		expect(launch.args[1]).not.toContain("OTEL_LOG_");
	});
});
