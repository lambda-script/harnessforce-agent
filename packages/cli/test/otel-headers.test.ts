import { managedDir } from "@harnessforce/test-support/managed-dir";
import { describe, expect, it } from "vitest";
import { fakeKeychain, runCli } from "./support/cli.js";

const header = (key: string) =>
	`${JSON.stringify({ Authorization: `Bearer ${key}` })}\n`;
const WITHHELD = "harnessforce: user key withheld (destination not verified)\n";

// harnessforce loginの後の状態。keyとともに送信先のoriginを保存している。
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

describe("harnessforce otel-headers", () => {
	// hookはotel-headersを1秒で打ち切るため、解錠の確認を待つ読み出しもその時間で終える。
	it("bounds each keychain operation by 1 second", async () => {
		const { keychain, timeouts } = fakeKeychain({
			items: {
				"ws1:ingest-key": "hf_ik_ws1_user",
				"ws1:ingest-origin": "https://ingest.example.test",
			},
		});
		expect(
			await runCli(["otel-headers"], { env: userEnv, keychain }),
		).toMatchObject({ code: 0, out: header("hf_ik_ws1_user") });
		expect(timeouts).toEqual([1_000]);
	});

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

	// correlation.md「CLI」の送信先の固定: Workspace用のkeyはmanaged settingsのfileが配るoriginと比べる。
	// runCliの既定のkeychainは触れると例外になるため、keychainを読まないことも確かめる。
	const managedIngest = (env: Record<string, string> = {}) =>
		managedDir({
			env: {
				HARNESSFORCE_INGEST_KEY: "hf_ik_ws9_managed",
				HARNESSFORCE_ENDPOINT: "https://ingest.example.test/base",
				...env,
			},
		});

	it("prints the managed Workspace key without reading the keychain when no destination variable is present", async () =>
		expect(
			await runCli(["otel-headers"], { env: {}, managedDir: managedIngest() }),
		).toEqual({ code: 0, out: header("hf_ik_ws9_managed"), err: "" }));

	it("prints the managed Workspace key when every destination matches an origin the managed file ships", async () =>
		expect(
			await runCli(["otel-headers"], {
				env: {
					HARNESSFORCE_ENDPOINT: "https://INGEST.example.test:443/base",
					OTEL_EXPORTER_OTLP_ENDPOINT: "https://ingest.example.test/base/",
				},
				managedDir: managedIngest(),
			}),
		).toEqual({ code: 0, out: header("hf_ik_ws9_managed"), err: "" }));

	// 組織がテレメトリを自前のcollectorへ送る構成を壊さない。
	it("prints the managed Workspace key for the organization's collector shipped in the managed file", async () =>
		expect(
			await runCli(["otel-headers"], {
				env: {
					HARNESSFORCE_ENDPOINT: "https://ingest.example.test/base",
					OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.corp.test:4318",
					OTEL_EXPORTER_OTLP_LOGS_ENDPOINT:
						"https://collector.corp.test:4318/v1/logs",
				},
				managedDir: managedDir(
					{ env: { HARNESSFORCE_INGEST_KEY: "hf_ik_ws9_managed" } },
					{
						"20-endpoints.json": JSON.stringify({
							env: {
								HARNESSFORCE_ENDPOINT: "https://ingest.example.test/base",
								OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.corp.test:4318",
							},
						}),
					},
				),
			}),
		).toEqual({ code: 0, out: header("hf_ik_ws9_managed"), err: "" }));

	it.each([
		[
			"a project sets a per-signal endpoint the managed file does not ship",
			{
				HARNESSFORCE_ENDPOINT: "https://ingest.example.test/base",
				OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "https://evil.example.test/v1/logs",
			},
			() => managedIngest(),
		],
		[
			"a destination breaks the scheme rule",
			{ OTEL_EXPORTER_OTLP_ENDPOINT: "http://ingest.example.test/base" },
			() => managedIngest(),
		],
		[
			"the managed file ships no destination",
			{ OTEL_EXPORTER_OTLP_ENDPOINT: "https://ingest.example.test" },
			() =>
				managedDir({ env: { HARNESSFORCE_INGEST_KEY: "hf_ik_ws9_managed" } }),
		],
		[
			"the managed file's only destination breaks the scheme rule",
			{ HARNESSFORCE_ENDPOINT: "http://ingest.example.test" },
			() =>
				managedIngest({ HARNESSFORCE_ENDPOINT: "http://ingest.example.test" }),
		],
	])("withholds the managed Workspace key when %s", async (_, env, dir) =>
		expect(await runCli(["otel-headers"], { env, managedDir: dir() })).toEqual({
			code: 4,
			out: "",
			err: WITHHELD,
		}),
	);

	// hookが選ぶWorkspace用のkeyと異なるkeyでテレメトリを送らない。
	it("does not fall back to the user key when the managed Workspace key is withheld", async () =>
		expect(
			await runCli(["otel-headers"], {
				env: {
					HARNESSFORCE_WORKSPACE_ID: "ws1",
					OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "https://evil.example.test/v1/logs",
				},
				// 利用者用のkeyだけなら送信先の固定を通る組。
				keychain: pinned({ "ws1:ingest-origin": "https://evil.example.test" }),
				managedDir: managedIngest(),
			}),
		).toEqual({ code: 4, out: "", err: WITHHELD }));

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
			{ code: 4, out: "", err: WITHHELD },
		),
	);

	it("withholds the user key when no origin was pinned", async () => {
		const { keychain } = fakeKeychain({
			items: { "ws1:ingest-key": "hf_ik_ws1_user" },
		});
		expect(await runCli(["otel-headers"], { env: userEnv, keychain })).toEqual({
			code: 4,
			out: "",
			err: WITHHELD,
		});
	});

	// correlation.md「CLI」: hookは終了コードで表示する文言を選ぶ。3はkeyが無い、1はそれ以外の失敗。
	it.each([
		[
			"HARNESSFORCE_WORKSPACE_ID is missing",
			{ HARNESSFORCE_ENDPOINT: userEnv.HARNESSFORCE_ENDPOINT },
			pinned(),
			3,
		],
		[
			"the workspace has no key",
			{ ...userEnv, HARNESSFORCE_WORKSPACE_ID: "ws3" },
			pinned(),
			3,
		],
		[
			"the keychain is unavailable",
			userEnv,
			fakeKeychain({
				available: false,
				items: { "ws1:ingest-key": "hf_ik_ws1_user" },
			}).keychain,
			1,
		],
		[
			"the keychain cannot be read",
			userEnv,
			fakeKeychain({ failRead: true }).keychain,
			1,
		],
	])("prints nothing and fails when %s", async (_, env, keychain, code) =>
		expect(await runCli(["otel-headers"], { env, keychain })).toEqual({
			code,
			out: "",
			err: "",
		}),
	);

	// correlation.md「CLI」: kernelのkeyringから読んだkeyを出力した後、Secret Serviceへ移す。
	describe("moving the kernel keyring items", () => {
		// Claude Codeがhelperの出力を待つ時間を、移す処理の分だけ延ばさない。
		it("closes stdout after printing the key and then moves the workspace items", async () => {
			const { keychain, migrations } = fakeKeychain({
				items: {
					"ws1:ingest-key": "hf_ik_ws1_user",
					"ws1:ingest-origin": "https://ingest.example.test",
				},
			});
			const order: string[] = [];
			const moving = keychain.migrateFromKernel;
			keychain.migrateFromKernel = async (workspaceId) => {
				order.push("migrate");
				await moving?.(workspaceId);
			};
			expect(
				await runCli(["otel-headers"], {
					env: userEnv,
					keychain,
					endStdout: async () => {
						order.push("end stdout");
					},
				}),
			).toEqual({ code: 0, out: header("hf_ik_ws1_user"), err: "" });
			expect(order).toEqual(["end stdout", "migrate"]);
			expect(migrations).toEqual(["ws1"]);
		});

		// hookはこの変数を付けて起動する。hookの1秒の上限を移す処理で使わないためである。
		it("does not move when HARNESSFORCE_NO_MIGRATE is set", async () => {
			const { keychain, migrations } = fakeKeychain({
				items: {
					"ws1:ingest-key": "hf_ik_ws1_user",
					"ws1:ingest-origin": "https://ingest.example.test",
				},
			});
			await runCli(["otel-headers"], {
				env: { ...userEnv, HARNESSFORCE_NO_MIGRATE: "1" },
				keychain,
			});
			expect(migrations).toEqual([]);
		});

		it("keeps the exit code when moving fails", async () => {
			const { keychain } = fakeKeychain({
				items: {
					"ws1:ingest-key": "hf_ik_ws1_user",
					"ws1:ingest-origin": "https://ingest.example.test",
				},
				failMigration: true,
			});
			expect(
				await runCli(["otel-headers"], { env: userEnv, keychain }),
			).toEqual({ code: 0, out: header("hf_ik_ws1_user"), err: "" });
		});

		it("does not move a withheld key", async () => {
			const withheld = fakeKeychain({
				items: { "ws1:ingest-key": "hf_ik_ws1_user" },
			});
			await runCli(["otel-headers"], {
				env: userEnv,
				keychain: withheld.keychain,
			});
			expect(withheld.migrations).toEqual([]);
		});
	});
});
