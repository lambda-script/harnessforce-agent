import { describe, expect, it } from "vitest";
import { fakeKeychain, managedDir, runCli } from "./support/cli.js";

const header = (key: string) =>
	`${JSON.stringify({ Authorization: `Bearer ${key}` })}\n`;
const WITHHELD = "harnessforce: user key withheld (destination not verified)\n";

// hf initの後の状態。keyとともに送信先のoriginを保存している。
const pinned = (extra: Record<string, string> = {}) =>
	fakeKeychain({
		items: {
			"ws1:ingest-key": "hf_ik_ws1_user",
			"ws1:ingest-origin": "https://ingest.example.test",
			"ws2:ingest-key": "hf_ik_ws2_user",
			"ws2:ingest-origin": "https://ingest.example.test",
			...extra,
		},
	}).keychain;

const userEnv = {
	HARNESSFORCE_WORKSPACE_ID: "ws1",
	HARNESSFORCE_ENDPOINT: "https://ingest.example.test/base",
	OTEL_EXPORTER_OTLP_ENDPOINT: "https://ingest.example.test/base/",
};

describe("hf otel-headers", () => {
	it("prints the user ingest key when every destination matches the pinned origin", async () =>
		expect(
			await runCli(["otel-headers"], { env: userEnv, keychain: pinned() }),
		).toEqual({ code: 0, out: header("hf_ik_ws1_user"), err: "" }));

	it("accepts a single destination variable", async () =>
		expect(
			await runCli(["otel-headers"], {
				env: {
					HARNESSFORCE_WORKSPACE_ID: "ws1",
					HARNESSFORCE_ENDPOINT: "https://ingest.example.test",
				},
				keychain: pinned(),
			}),
		).toEqual({ code: 0, out: header("hf_ik_ws1_user"), err: "" }));

	// otelHeadersHelperのprocessに渡る環境変数は記載されておらず、OTLPの送信先はrepositoryのsettingsで変えられない。
	it("releases the user key when no destination variable is present", async () =>
		expect(
			await runCli(["otel-headers"], {
				env: { HARNESSFORCE_WORKSPACE_ID: "ws1" },
				keychain: pinned(),
			}),
		).toEqual({ code: 0, out: header("hf_ik_ws1_user"), err: "" }));

	it("compares serialized origins, ignoring the default port and host case", async () =>
		expect(
			await runCli(["otel-headers"], {
				env: {
					HARNESSFORCE_WORKSPACE_ID: "ws1",
					HARNESSFORCE_ENDPOINT: "https://INGEST.example.test:443/base",
				},
				keychain: pinned(),
			}),
		).toEqual({ code: 0, out: header("hf_ik_ws1_user"), err: "" }));

	it("accepts userinfo on the pinned host and ignores empty destination variables", async () =>
		expect(
			await runCli(["otel-headers"], {
				env: {
					HARNESSFORCE_WORKSPACE_ID: "ws1",
					HARNESSFORCE_ENDPOINT: "https://u:p@ingest.example.test/base",
					OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "",
				},
				keychain: pinned(),
			}),
		).toEqual({ code: 0, out: header("hf_ik_ws1_user"), err: "" }));

	it("prints the managed Workspace key without reading the keychain or the destination", async () =>
		// runCliの既定のkeychainは、触れると例外になる。
		expect(
			await runCli(["otel-headers"], {
				env: {
					OTEL_EXPORTER_OTLP_ENDPOINT: "https://elsewhere.example.test",
				},
				managedDir: managedDir({
					env: { HARNESSFORCE_INGEST_KEY: "hf_ik_ws9_managed" },
				}),
			}),
		).toEqual({ code: 0, out: header("hf_ik_ws9_managed"), err: "" }));

	it("ignores HARNESSFORCE_INGEST_KEY from the process environment", async () =>
		expect(
			await runCli(["otel-headers"], {
				env: { ...userEnv, HARNESSFORCE_INGEST_KEY: "hf_ik_evil_key" },
				keychain: pinned(),
			}),
		).toEqual({ code: 0, out: header("hf_ik_ws1_user"), err: "" }));

	it("ignores an unreadable managed file and uses the user key", async () =>
		expect(
			await runCli(["otel-headers"], {
				env: userEnv,
				keychain: pinned(),
				managedDir: managedDir(null, { "10.json": "{" }),
			}),
		).toEqual({ code: 0, out: header("hf_ik_ws1_user"), err: "" }));

	it.each([
		[
			"a project overrides the OTLP endpoint",
			{ ...userEnv, OTEL_EXPORTER_OTLP_ENDPOINT: "https://evil.example.test" },
		],
		[
			"a per-signal endpoint points elsewhere",
			{
				...userEnv,
				OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "https://evil.example.test/v1/logs",
			},
		],
		[
			"the port differs",
			{
				...userEnv,
				HARNESSFORCE_ENDPOINT: "https://ingest.example.test:8443",
			},
		],
		[
			"a destination has a trailing dot host",
			{
				...userEnv,
				HARNESSFORCE_ENDPOINT: "https://ingest.example.test./base",
			},
		],
		[
			"a destination hides another host behind userinfo",
			{
				...userEnv,
				HARNESSFORCE_ENDPOINT: "https://ingest.example.test@evil.example.test",
			},
		],
		[
			"a destination breaks the scheme rule",
			{ ...userEnv, HARNESSFORCE_ENDPOINT: "http://ingest.example.test" },
		],
	])("withholds the user key when %s", async (_, env) =>
		expect(await runCli(["otel-headers"], { env, keychain: pinned() })).toEqual(
			{ code: 1, out: "", err: WITHHELD },
		));

	it("withholds the user key when no origin was pinned", async () => {
		const { keychain } = fakeKeychain({
			items: { "ws1:ingest-key": "hf_ik_ws1_user" },
		});
		expect(await runCli(["otel-headers"], { env: userEnv, keychain })).toEqual({
			code: 1,
			out: "",
			err: WITHHELD,
		});
	});

	it.each([
		[
			"HARNESSFORCE_WORKSPACE_ID is missing",
			{ HARNESSFORCE_ENDPOINT: userEnv.HARNESSFORCE_ENDPOINT },
			pinned(),
		],
		[
			"the keychain is unavailable",
			userEnv,
			fakeKeychain({
				available: false,
				items: { "ws1:ingest-key": "hf_ik_ws1_user" },
			}).keychain,
		],
		[
			"the workspace has no key",
			{ ...userEnv, HARNESSFORCE_WORKSPACE_ID: "ws3" },
			pinned(),
		],
		[
			"the keychain cannot be read",
			userEnv,
			fakeKeychain({ failRead: true }).keychain,
		],
	])("prints nothing and fails when %s", async (_, env, keychain) =>
		expect(await runCli(["otel-headers"], { env, keychain })).toEqual({
			code: 1,
			out: "",
			err: "",
		}));
});
