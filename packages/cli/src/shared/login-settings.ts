import { createHash } from "node:crypto";
import { isObject } from "@harnessforce/agent-core/object";

// `harnessforce login`が書く設定と、`harnessforce logout`と`harnessforce config`がそれを書き換える規則を1か所に置く。
// loginが書く鍵とlogoutが消す鍵が食い違うと、logoutの後に送信先やkeyの無い設定が残るためである。

// correlation.md「CLI」の手順4: Workspaceの本文データの設定。`GET /api/v1/workspace`の`content`も同じ形（read-api.md）。
export type ContentSettings = {
	isPromptsStored: boolean;
	isModelAndToolsStored: boolean;
	visibility: ContentVisibility;
	retentionDays: number;
};
type ContentVisibility =
	| "all_members"
	| "owners_admins_and_sender"
	| "sender_only";

const VISIBILITIES: ReadonlySet<string> = new Set([
	"all_members",
	"owners_admins_and_sender",
	"sender_only",
]);
const RETENTION_DAYS: ReadonlySet<unknown> = new Set([7, 14, 30]);

// 条件を満たさない`content`はundefined。
export function parseContentSettings(
	value: unknown,
): ContentSettings | undefined {
	if (!isObject(value)) return undefined;
	const { prompts, model_and_tools: modelAndTools, visibility } = value;
	const retentionDays = value.retention_days;
	if (
		typeof prompts !== "boolean" ||
		typeof modelAndTools !== "boolean" ||
		typeof visibility !== "string" ||
		!VISIBILITIES.has(visibility) ||
		typeof retentionDays !== "number" ||
		!RETENTION_DAYS.has(retentionDays)
	)
		return undefined;
	return {
		isPromptsStored: prompts,
		isModelAndToolsStored: modelAndTools,
		visibility: visibility as ContentVisibility,
		retentionDays,
	};
}

// privacy-and-retention.md「本文の送信の設定」のClaude Codeの4つの変数。
export const CONTENT_ENV_NAMES = [
	"OTEL_LOG_USER_PROMPTS",
	"OTEL_LOG_ASSISTANT_RESPONSES",
	"OTEL_LOG_TOOL_DETAILS",
	"OTEL_LOG_TOOL_CONTENT",
] as const;
type ContentEnvName = (typeof CONTENT_ENV_NAMES)[number];

// correlation.md「CLI」の手順6。送らない区分も明示に`0`で書く。
// 未設定の変数がagentの既定や他の変数に従って、選んでいない区分の本文が届かないようにするため。
// `OTEL_LOG_ASSISTANT_RESPONSES`は未設定だと`OTEL_LOG_USER_PROMPTS`に従う。
export function contentEnv(
	content: ContentSettings,
	sendContent: boolean,
): Record<ContentEnvName, string> {
	const flag = (isStored: boolean) => (sendContent && isStored ? "1" : "0");
	const modelAndTools = flag(content.isModelAndToolsStored);
	return {
		OTEL_LOG_USER_PROMPTS: flag(content.isPromptsStored),
		OTEL_LOG_ASSISTANT_RESPONSES: modelAndTools,
		OTEL_LOG_TOOL_DETAILS: modelAndTools,
		OTEL_LOG_TOOL_CONTENT: modelAndTools,
	};
}

// correlation.md「CLI」の手順6の一覧（本文の4つの変数を除く）。logoutはこれと本文の4つの変数を消す。
export const LOGIN_ENV_NAMES = [
	"HARNESSFORCE_URL",
	"HARNESSFORCE_ENDPOINT",
	"OTEL_EXPORTER_OTLP_ENDPOINT",
	"HARNESSFORCE_WORKSPACE_ID",
	"CLAUDE_CODE_ENABLE_TELEMETRY",
	"CLAUDE_CODE_ENHANCED_TELEMETRY_BETA",
	"OTEL_METRICS_INCLUDE_ENTRYPOINT",
	"OTEL_METRICS_EXPORTER",
	"OTEL_LOGS_EXPORTER",
	"OTEL_TRACES_EXPORTER",
	"OTEL_EXPORTER_OTLP_PROTOCOL",
	"OTEL_LOGS_EXPORT_INTERVAL",
	"OTEL_TRACES_EXPORT_INTERVAL",
	"OTEL_METRIC_EXPORT_INTERVAL",
] as const;
type LoginEnvName = (typeof LOGIN_ENV_NAMES)[number];

// correlation.md「CLI」の手順6の値。型が鍵をLOGIN_ENV_NAMESと揃える。
export function loginEnv(values: {
	connection: string;
	ingestEndpoint: string;
	workspaceId: string;
}): Record<LoginEnvName, string> {
	return {
		HARNESSFORCE_URL: values.connection,
		HARNESSFORCE_ENDPOINT: values.ingestEndpoint,
		OTEL_EXPORTER_OTLP_ENDPOINT: values.ingestEndpoint,
		HARNESSFORCE_WORKSPACE_ID: values.workspaceId,
		CLAUDE_CODE_ENABLE_TELEMETRY: "1",
		CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
		OTEL_METRICS_INCLUDE_ENTRYPOINT: "true",
		OTEL_METRICS_EXPORTER: "otlp",
		OTEL_LOGS_EXPORTER: "otlp",
		OTEL_TRACES_EXPORTER: "otlp",
		OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
		// ingestの受信の費用は受信の回数にほぼ比例するため、logsとtracesを既定の5秒から60秒に延ばす。
		// metricsは既定と同じ60秒でも書き、shellに残った別の値を置き換えて3つを揃える。
		OTEL_LOGS_EXPORT_INTERVAL: "60000",
		OTEL_TRACES_EXPORT_INTERVAL: "60000",
		OTEL_METRIC_EXPORT_INTERVAL: "60000",
	};
}

// control-plane.md「IngestKey と ApiToken」のhash。loginとlogoutの`revoke_key_hashes`、loginの`revoke_api_token_hashes`に使う。
export const sha256Hex = (value: string) =>
	createHash("sha256").update(value, "utf8").digest("hex");
