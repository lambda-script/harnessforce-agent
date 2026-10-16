import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { managedDir } from "@harnessforce/test-support/managed-dir";
import { afterEach, describe, expect, it } from "vitest";
import { isTelemetryConfigured } from "../src/telemetry-settings.js";

// `harnessforce init`の手順6が書くテレメトリの設定（correlation.md「CLI」）。
const INIT_ENV = {
	CLAUDE_CODE_ENABLE_TELEMETRY: "1",
	OTEL_METRICS_EXPORTER: "otlp",
	OTEL_LOGS_EXPORTER: "otlp",
	OTEL_TRACES_EXPORTER: "otlp",
	OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
};

const dirs: string[] = [];
afterEach(async () => {
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true });
});

async function homeWith(settings: unknown): Promise<string> {
	const home = await mkdtemp(join(tmpdir(), "hf-telemetry-settings-"));
	dirs.push(home);
	await writeFile(
		join(home, "settings.json"),
		typeof settings === "string" ? settings : JSON.stringify(settings),
	);
	return home;
}

const check = (configDir: string, managed: Record<string, string> | null) =>
	isTelemetryConfigured({
		userSettingsPath: join(configDir, "settings.json"),
		managedDir: managedDir(managed === null ? null : { env: managed }),
	});

describe("telemetry settings (correlation.md「送信の健全性」)", () => {
	it("is configured when user settings hold what harnessforce init writes", async () =>
		expect(
			await check(
				await homeWith({
					env: INIT_ENV,
					otelHeadersHelper: "harnessforce otel-headers",
				}),
				null,
			),
		).toBe(true));

	it("accepts an exporter list that includes otlp", async () =>
		expect(
			await check(
				await homeWith({
					env: { ...INIT_ENV, OTEL_LOGS_EXPORTER: "console,otlp" },
					otelHeadersHelper: "harnessforce otel-headers",
				}),
				null,
			),
		).toBe(true));

	it.each([
		["CLAUDE_CODE_ENABLE_TELEMETRY", "0"],
		["OTEL_TRACES_EXPORTER", "none"],
		["OTEL_EXPORTER_OTLP_PROTOCOL", "grpc"],
	])("is missing when %s is %s", async (name, value) =>
		expect(
			await check(
				await homeWith({
					env: { ...INIT_ENV, [name]: value },
					otelHeadersHelper: "harnessforce otel-headers",
				}),
				null,
			),
		).toBe(false),
	);

	it("is missing when the telemetry variable was removed", async () => {
		const { CLAUDE_CODE_ENABLE_TELEMETRY: _, ...rest } = INIT_ENV;
		expect(
			await check(await homeWith({ env: rest, otelHeadersHelper: "x" }), null),
		).toBe(false);
	});

	it("is missing without otelHeadersHelper in user settings", async () =>
		expect(await check(await homeWith({ env: INIT_ENV }), null)).toBe(false));

	it("is missing when the user settings file is absent or not JSON", async () => {
		expect(await check("/nonexistent/hf-config", null)).toBe(false);
		expect(await check(await homeWith("{"), null)).toBe(false);
	});

	// managed settingsのfileの値が、user settingsの値より優先される。
	it("prefers the managed settings file value for each variable", async () => {
		const home = await homeWith({
			env: INIT_ENV,
			otelHeadersHelper: "harnessforce otel-headers",
		});
		expect(await check(home, { CLAUDE_CODE_ENABLE_TELEMETRY: "0" })).toBe(
			false,
		);
		const partial = await homeWith({
			env: { OTEL_LOGS_EXPORTER: "otlp" },
			otelHeadersHelper: "harnessforce otel-headers",
		});
		expect(await check(partial, INIT_ENV)).toBe(true);
	});
});
