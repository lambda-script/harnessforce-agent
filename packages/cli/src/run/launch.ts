import { ATTR } from "@harnessforce/semconv";
import type { Env } from "../otel-headers.js";

export type LaunchAttributes = {
	issueIdentifier: string;
	repository?: string;
	branch?: string;
	commit?: string;
	configVersion?: string;
};

export type LaunchRequest = {
	agent: string;
	args: readonly string[];
	issueIdentifier: string;
	resourceAttributes: string;
	shellEnv: Env;
	workspaceId: string;
	ingestEndpoint: string;
	ingestKey: string;
};

export type Launch = {
	command: string;
	args: string[];
	env: Record<string, string>;
};

// `--settings`を解釈するagent。basenameで判定する（Windowsのnpmが入れる`claude.cmd`を含む）。
const CLAUDE_CODE_BINARIES = new Set(["claude", "claude.exe", "claude.cmd"]);

export const isClaudeCode = (agent: string) =>
	CLAUDE_CODE_BINARIES.has(agent.split(/[\\/]/).pop()?.toLowerCase() ?? "");

// agent-telemetry.md: OTEL_RESOURCE_ATTRIBUTESはカンマ区切りのk=vで、値の空白、カンマなどはpercent-encodeする。
export function resourceAttributes(
	attributes: LaunchAttributes,
	shellValue: string | undefined,
): string {
	const ours = [
		[ATTR.issueIdentifier, attributes.issueIdentifier],
		[ATTR.vcsRepository, attributes.repository],
		[ATTR.vcsBranch, attributes.branch],
		[ATTR.vcsCommit, attributes.commit],
		[ATTR.agentConfigVersion, attributes.configVersion],
	].flatMap(([name, value]) =>
		value === undefined ? [] : [`${name}=${encodeURIComponent(value)}`],
	);
	// 利用者がshellで付けた属性は残す。hf.*はhf runが決めた値だけにする。
	const kept = (shellValue ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "" && !entry.startsWith("hf."));
	return [...kept, ...ours].join(",");
}

// correlation.md「CLI」の`hf run`の手順3から5。
export function buildLaunch(request: LaunchRequest): Launch {
	// 手順3の値。Claude Codeには手順4で`--settings`の`env`としても同じ値を渡す。
	const stepThree: Record<string, string> = {
		HARNESSFORCE_WORKSPACE_ID: request.workspaceId,
		HARNESSFORCE_ENDPOINT: request.ingestEndpoint,
		OTEL_EXPORTER_OTLP_ENDPOINT: request.ingestEndpoint,
		OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${request.ingestKey}`,
		CLAUDE_CODE_ENABLE_TELEMETRY: "1",
		CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
		OTEL_RESOURCE_ATTRIBUTES: request.resourceAttributes,
	};
	const shellEnv = Object.fromEntries(
		Object.entries(request.shellEnv).filter(
			(entry): entry is [string, string] => entry[1] !== undefined,
		),
	);
	const settingsArgs = isClaudeCode(request.agent)
		? ["--settings", JSON.stringify({ env: stepThree })]
		: [];
	return {
		command: request.agent,
		args: [...settingsArgs, ...request.args],
		env: {
			...shellEnv,
			...stepThree,
			// 手順5: pluginのhookがsession registrationに`issue_identifier`と`source=cli`を付ける。
			HARNESSFORCE_ISSUE: request.issueIdentifier,
		},
	};
}
