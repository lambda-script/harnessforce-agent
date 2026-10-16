import { readJsonObjectFile } from "./config/files.js";
import { readManagedEnv } from "./managed.js";
import { isObject } from "./object.js";

// `harnessforce init`の手順6が書く値（correlation.md「CLI」）。exporterは一覧の形でotlpを含めばよい。
const EXPECTED = {
	CLAUDE_CODE_ENABLE_TELEMETRY: (value: string) => value === "1",
	OTEL_LOGS_EXPORTER: (value: string) => includesOtlp(value),
	OTEL_METRICS_EXPORTER: (value: string) => includesOtlp(value),
	OTEL_TRACES_EXPORTER: (value: string) => includesOtlp(value),
	OTEL_EXPORTER_OTLP_PROTOCOL: (value: string) => value === "http/protobuf",
} as const;
type Name = keyof typeof EXPECTED;
const NAMES = Object.keys(EXPECTED) as Name[];

const includesOtlp = (value: string) =>
	value.split(",").some((exporter) => exporter.trim() === "otlp");

const noGuard = () => {};

// correlation.md「送信の健全性」のテレメトリの設定。managed settingsのfileの値を、無ければuser settingsの値を使う。
// repositoryのsettingsが止める値は、一覧が記載されておらず判定しない。
export async function isTelemetryConfigured(options: {
	userSettingsPath: string;
	managedDir: string;
}): Promise<boolean> {
	const managed = await readManagedEnv(options.managedDir, NAMES);
	const settings = await readJsonObjectFile(
		options.userSettingsPath,
		noGuard,
	).catch(() => undefined);
	const userEnv = isObject(settings?.env) ? settings.env : {};
	const isEachSet = NAMES.every((name) => {
		const value = managed[name] ?? userEnv[name];
		return typeof value === "string" && EXPECTED[name](value);
	});
	return isEachSet && typeof settings?.otelHeadersHelper === "string";
}
