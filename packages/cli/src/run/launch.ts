import type { Env } from "@harnessforce/agent-core/types";
import { ATTR } from "@harnessforce/semconv";

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
	platform: NodeJS.Platform;
};

export type Launch = {
	command: string;
	// 利用者の引数。`--settings`のfileは起動の直前に作り、この前に置く。
	args: string[];
	env: Record<string, string>;
	// Claude Codeの場合だけ、`--settings`のfileの`env`に書く値。
	settingsEnv?: Record<string, string>;
};

// shellの環境から除く変数。他の送信先の資格情報をHarnessforceへ送らず、signal別の送信先で
// helperの送信先の確認を外させず、signal別のprotocolでhelperのheaderが使われなくなることを防ぐ。
const STRIPPED_FROM_SHELL = new Set([
	"OTEL_EXPORTER_OTLP_HEADERS",
	...["TRACES", "LOGS", "METRICS"].flatMap((signal) => [
		`OTEL_EXPORTER_OTLP_${signal}_HEADERS`,
		`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`,
		`OTEL_EXPORTER_OTLP_${signal}_PROTOCOL`,
	]),
]);

// `--settings`を解釈するagent。basenameで判定する（Windowsのnpmが入れる`claude.cmd`を含む）。
const CLAUDE_CODE_BINARIES = new Set(["claude", "claude.exe", "claude.cmd"]);

const basenameOf = (agent: string) =>
	agent.split(/[\\/]/).pop()?.toLowerCase() ?? "";

export const isClaudeCode = (agent: string) =>
	CLAUDE_CODE_BINARIES.has(basenameOf(agent));

// correlation.md「`harnessforce run -- codex`」手順4: basenameが`codex`、`codex.exe`、`codex.cmd`のagent。
const CODEX_BINARIES = new Set(["codex", "codex.exe", "codex.cmd"]);

export const isCodex = (agent: string) => CODEX_BINARIES.has(basenameOf(agent));

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
	// 利用者がshellで付けた属性は残す。hf.*はharnessforce runが決めた値だけにする。
	const kept = (shellValue ?? "")
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry !== "" && !entry.startsWith("hf."));
	return [...kept, ...ours].join(",");
}

// correlation.md「CLI」の`harnessforce run`の手順3から5。利用者用のkeyとApiTokenはどこにも置かない。
export function buildLaunch(request: LaunchRequest): Launch {
	const harnessforceEnv: Record<string, string> = {
		HARNESSFORCE_WORKSPACE_ID: request.workspaceId,
		HARNESSFORCE_ENDPOINT: request.ingestEndpoint,
		// 手順5: pluginのhookがsession registrationに`issue_identifier`と`source=cli`を付ける。
		HARNESSFORCE_ISSUE: request.issueIdentifier,
	};
	// Codexは`CLAUDE_CODE_*`と`OTEL_RESOURCE_ATTRIBUTES`を読まず、`OTEL_EXPORTER_OTLP_ENDPOINT`を設定すると
	// `[otel]`のexporterのendpointの代わりに使われ、headerが付かないおそれがある。送信先は`harnessforce init`が書いた
	// `config.toml`に任せ、環境にはHARNESSFORCE_*の3つだけを置く。
	const injectedEnv: Record<string, string> = isCodex(request.agent)
		? harnessforceEnv
		: {
				...harnessforceEnv,
				OTEL_EXPORTER_OTLP_ENDPOINT: request.ingestEndpoint,
				// helperのheaderはHTTPのprotocolでだけ使われる。
				OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
				CLAUDE_CODE_ENABLE_TELEMETRY: "1",
				CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
				OTEL_RESOURCE_ATTRIBUTES: request.resourceAttributes,
			};
	// Windowsの環境変数の名前は大文字と小文字を区別しないため、別の綴りの同じ変数も除く。
	const normalize = (name: string) =>
		request.platform === "win32" ? name.toUpperCase() : name;
	// Codexには送信先と資格情報の変数を設定しないため、利用者のshellの値は除かない。
	const stripped = isCodex(request.agent) ? [] : [...STRIPPED_FROM_SHELL];
	const replaced = new Set(
		[...stripped, ...Object.keys(injectedEnv)].map(normalize),
	);
	const shellEnv = Object.fromEntries(
		Object.entries(request.shellEnv).filter(
			(entry): entry is [string, string] =>
				entry[1] !== undefined && !replaced.has(normalize(entry[0])),
		),
	);
	return {
		command: request.agent,
		args: [...request.args],
		env: { ...shellEnv, ...injectedEnv },
		...(isClaudeCode(request.agent) ? { settingsEnv: injectedEnv } : {}),
	};
}
