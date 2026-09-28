import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createImportGit } from "../../src/import/repository.js";
import { tempDir } from "../config/support.js";
import { fakeKeychain, managedDir } from "../support/cli.js";
import {
	gitRepository,
	initializedHome,
	initializedKeychain,
	NOW,
	runImport,
	startHarnessforce,
	storedToken,
	transcript,
} from "./harness.js";

const RUN_INIT = "`hf init`を実行してください\n";
const EXPIRED = "ログインの有効期限が切れました。`hf init`を実行してください\n";
const READ_FAILED =
	"Harnessforceとの通信に失敗しました。もう一度`hf import`を実行してください\n";
const SEND_FAILED =
	"Harnessforceとの通信に失敗しました。もう一度`hf import`を実行すると続きから取り込みます\n";

async function setup(
	options: Parameters<typeof startHarnessforce>[0] = {},
	sessionCount = 1,
) {
	const hf = await startHarnessforce(options);
	const cwd = gitRepository();
	const sessions = Object.fromEntries(
		Array.from({ length: sessionCount }, (_, i) => [
			`s${String(i).padStart(3, "0")}`,
			transcript(`s${String(i).padStart(3, "0")}`, cwd),
		]),
	);
	const home = initializedHome(
		{
			HARNESSFORCE_URL: hf.appUrl,
			HARNESSFORCE_ENDPOINT: `${hf.ingestUrl}/`,
			HARNESSFORCE_WORKSPACE_ID: "ws1",
		},
		sessions,
	);
	const keychain = initializedKeychain(hf.origin);
	const run = (deps: Parameters<typeof runImport>[0] = {}) =>
		runImport({
			homeDir: home.home,
			keychain: keychain.keychain,
			importGit: createImportGit(process.env, process.cwd()),
			...deps,
		});
	return { hf, home, keychain, cwd, run };
}

// correlation.md「session import」: 記録の基点はmanaged settingsのfile、~/.claude/settings.jsonのenvの順に読み、
// processの環境変数のCLAUDE_CONFIG_DIRは読まない。
describe("hf import record base", () => {
	function configDirWith(sessionId: string, cwd: string): string {
		const dir = tempDir("hf-config-");
		mkdirSync(join(dir, "projects", "-work-web"), { recursive: true });
		writeFileSync(
			join(dir, "projects", "-work-web", `${sessionId}.jsonl`),
			transcript(sessionId, cwd),
		);
		return dir;
	}

	function addUserEnv(home: string, extra: Record<string, string>) {
		const path = join(home, ".claude", "settings.json");
		const settings = JSON.parse(readFileSync(path, "utf8"));
		writeFileSync(
			path,
			JSON.stringify({ ...settings, env: { ...settings.env, ...extra } }),
		);
	}

	it("ignores CLAUDE_CONFIG_DIR from the process environment", async () => {
		const { hf, home, cwd, run } = await setup();
		const crafted = configDirWith("crafted", cwd);
		const settings = JSON.parse(
			readFileSync(join(home.home, ".claude", "settings.json"), "utf8"),
		);
		expect(
			await run({ env: { ...settings.env, CLAUDE_CONFIG_DIR: crafted } }),
		).toMatchObject({ code: 0 });
		expect(hf.sessionBodies()).toEqual([["s000"]]);
	});

	it("reads CLAUDE_CONFIG_DIR from ~/.claude/settings.json", async () => {
		const { hf, home, cwd, run } = await setup();
		addUserEnv(home.home, { CLAUDE_CONFIG_DIR: configDirWith("moved", cwd) });
		expect(await run()).toMatchObject({ code: 0 });
		expect(hf.sessionBodies()).toEqual([["moved"]]);
	});

	it("prefers CLAUDE_CONFIG_DIR from the managed settings file", async () => {
		const { hf, home, cwd, run } = await setup();
		addUserEnv(home.home, { CLAUDE_CONFIG_DIR: configDirWith("user", cwd) });
		const managed = managedDir({
			env: { CLAUDE_CONFIG_DIR: configDirWith("managed", cwd) },
		});
		expect(await run({ managedDir: managed })).toMatchObject({ code: 0 });
		expect(hf.sessionBodies()).toEqual([["managed"]]);
	});

	it("ignores a relative CLAUDE_CONFIG_DIR", async () => {
		const { hf, home, run } = await setup();
		addUserEnv(home.home, { CLAUDE_CONFIG_DIR: "relative/config" });
		expect(await run()).toMatchObject({ code: 0 });
		expect(hf.sessionBodies()).toEqual([["s000"]]);
	});
});

describe("hf import", () => {
	it("sends connected sessions with the user key to the destinations saved by hf init", async () => {
		const { hf, home, run } = await setup();
		expect(await run()).toEqual({
			code: 0,
			out: "1件のsessionを取り込みました\n",
			err: "",
		});
		expect(hf.requests.map((r) => r.path)).toEqual([
			"GET /app/api/v1/repositories",
			"GET /app/api/v1/workspace",
			"POST /ingest/v1/imports/sessions",
		]);
		expect(hf.requests[0]?.headers.authorization).toBe(
			"Bearer hf_at_ws1_current",
		);
		expect(hf.requests[2]?.headers.authorization).toBe("Bearer hf_ik_ws1_user");
		expect(hf.requests[2]?.body).toEqual([
			expect.objectContaining({
				agent: "claude_code",
				source: "import",
				session_id: "s000",
				first_prompt_id: "prompt-s000",
				repository: "github.com/acme/web",
				branch: "eng-42-login",
				model: "claude-opus-5-5",
			}),
		]);
		expect(JSON.stringify(hf.requests)).not.toContain("SECRET");
		expect(home.readState()).toContain("s000");
	});

	it("does not send the same sessions twice", async () => {
		const { hf, run } = await setup();
		await run();
		expect(await run()).toMatchObject({
			code: 0,
			out: "0件のsessionを取り込みました\n",
		});
		expect(hf.sessionBodies()).toEqual([["s000"]]);
	});

	it("sends sessions already sent to another workspace to a newly initialized one", async () => {
		const { hf, run, keychain } = await setup();
		await run();
		const other = initializedKeychain(hf.origin, ["ws1", "ws2"]);
		expect(
			await run({
				keychain: other.keychain,
				env: { HARNESSFORCE_WORKSPACE_ID: "ws2" },
			}),
		).toMatchObject({ code: 0, out: "1件のsessionを取り込みました\n" });
		expect(hf.requests.at(-1)?.headers.authorization).toBe(
			"Bearer hf_ik_ws2_user",
		);
		expect(hf.sessionBodies()).toEqual([["s000"], ["s000"]]);
		expect(keychain.writes).toEqual([]);
	});

	it("prefers the shell environment over user settings", async () => {
		const { hf, run } = await setup();
		const shell = await startHarnessforce();
		const keychain = initializedKeychain(shell.origin);
		await run({
			keychain: keychain.keychain,
			env: {
				HARNESSFORCE_URL: shell.appUrl,
				HARNESSFORCE_ENDPOINT: shell.ingestUrl,
			},
		});
		expect(hf.requests).toEqual([]);
		expect(shell.sessionBodies()).toEqual([["s000"]]);
	});

	it("uses the build default when the user settings hold an empty connection URL", async () => {
		const hf = await startHarnessforce();
		const home = initializedHome(
			{
				HARNESSFORCE_URL: "",
				HARNESSFORCE_ENDPOINT: hf.ingestUrl,
				HARNESSFORCE_WORKSPACE_ID: "ws1",
			},
			{ s000: transcript("s000", gitRepository()) },
		);
		expect(
			await runImport({
				homeDir: home.home,
				keychain: initializedKeychain(hf.origin).keychain,
				defaultUrl: hf.appUrl,
				importGit: createImportGit(process.env, process.cwd()),
			}),
		).toMatchObject({ code: 0 });
		expect(hf.sessionBodies()).toEqual([["s000"]]);
	});

	it("reads every page of connected repositories", async () => {
		const { hf, run } = await setup({
			repositories: (cursor) => ({
				status: 200,
				body:
					cursor === "p2"
						? {
								data: [{ repository: "github.com/acme/web" }],
								next_cursor: null,
							}
						: {
								data: Array.from({ length: 100 }, (_, i) => ({
									repository: `github.com/acme/r${i}`,
								})),
								next_cursor: "p2",
							},
			}),
		});
		expect(await run()).toMatchObject({ code: 0 });
		expect(hf.sessionBodies()).toEqual([["s000"]]);
	});

	it("sends nothing for repositories that are not connected and sessions outside the window", async () => {
		const { hf, run } = await setup({
			repositories: () => ({
				status: 200,
				body: { data: [], next_cursor: null },
			}),
		});
		expect(await run()).toMatchObject({ code: 0 });
		const narrow = await setup({
			workspace: { status: 200, body: { session_import_days: 5 } },
		});
		expect(await narrow.run()).toMatchObject({ code: 0 });
		expect([...hf.sessionBodies(), ...narrow.hf.sessionBodies()]).toEqual([]);
	});

	describe("stops before sending and keeps the state file", () => {
		it("when the keychain is unavailable, without suggesting hf init", async () => {
			const { hf, home, run } = await setup();
			expect(
				await run({ keychain: fakeKeychain({ available: false }).keychain }),
			).toEqual({
				code: 1,
				out: "",
				err: "OSのキーチェーンを利用できないため、送信キーを保存できません\n",
			});
			expect(hf.requests).toEqual([]);
			expect(home.readState()).toBeUndefined();
		});

		// hf runと同じく、使えるかを確かめられないkeychainも使えないものとして扱う。
		it("when the keychain cannot tell whether it is available", async () => {
			const { hf, home, run } = await setup();
			expect(
				await run({
					keychain: fakeKeychain({ failAvailability: true }).keychain,
				}),
			).toEqual({
				code: 1,
				out: "",
				err: "OSのキーチェーンを利用できないため、送信キーを保存できません\n",
			});
			expect(hf.requests).toEqual([]);
			expect(home.readState()).toBeUndefined();
		});

		it.each([
			["the api token is missing", "ws1:api-token"],
			["the user ingest key is missing", "ws1:ingest-key"],
			["no origin was pinned", "ws1:ingest-origin"],
			["no connection origin was pinned", "ws1:url-origin"],
		])("when %s", async (_, account) => {
			const { hf, home, run, keychain } = await setup();
			keychain.items.delete(account);
			expect(await run()).toEqual({ code: 1, out: "", err: RUN_INIT });
			expect(hf.requests).toEqual([]);
			expect(home.readState()).toBeUndefined();
		});

		// hf runと同じく、空のkeyはkeyが無いものとする。
		it("when the user ingest key is empty", async () => {
			const { hf, home, run, keychain } = await setup();
			keychain.items.set("ws1:ingest-key", "");
			expect(await run()).toEqual({ code: 1, out: "", err: RUN_INIT });
			expect(hf.requests).toEqual([]);
			expect(home.readState()).toBeUndefined();
		});

		it("when there is no workspace or ingest endpoint", async () => {
			const hf = await startHarnessforce();
			const keychain = initializedKeychain(hf.origin);
			const envs: Record<string, string>[] = [
				{ HARNESSFORCE_ENDPOINT: hf.ingestUrl },
				{ HARNESSFORCE_WORKSPACE_ID: "ws1" },
			];
			for (const env of envs) {
				const home = initializedHome({ HARNESSFORCE_URL: hf.appUrl, ...env });
				expect(
					await runImport({ homeDir: home.home, keychain: keychain.keychain }),
				).toEqual({ code: 1, out: "", err: RUN_INIT });
			}
			expect(hf.requests).toEqual([]);
		});

		// correlation.md「CLIの宛先の決め方」をhf runと同じ関数で決める。空のuser settingsの値は無いものとする。
		it("when the user settings hold an empty ingest endpoint", async () => {
			const hf = await startHarnessforce();
			const keychain = initializedKeychain(hf.origin);
			const home = initializedHome({
				HARNESSFORCE_URL: hf.appUrl,
				HARNESSFORCE_ENDPOINT: "",
				HARNESSFORCE_WORKSPACE_ID: "ws1",
			});
			expect(
				await runImport({ homeDir: home.home, keychain: keychain.keychain }),
			).toEqual({ code: 1, out: "", err: RUN_INIT });
			expect(hf.requests).toEqual([]);
		});

		it("when the ingest endpoint points to another origin than hf init pinned", async () => {
			const { hf, home, run } = await setup();
			expect(
				await run({
					env: { HARNESSFORCE_ENDPOINT: "https://attacker.example.test" },
				}),
			).toEqual({ code: 1, out: "", err: RUN_INIT });
			expect(hf.requests).toEqual([]);
			expect(home.readState()).toBeUndefined();
		});

		// repositoryのsettingsの`env`が書き換えたHARNESSFORCE_URLへApiTokenを送らない。
		it("when the connection URL points to another origin than hf init pinned", async () => {
			const { home, run } = await setup();
			await run();
			const state = home.readState();
			const fetched: string[] = [];
			expect(
				await run({
					env: { HARNESSFORCE_URL: "https://attacker.example.test" },
					fetch: (url, init) => {
						fetched.push(String(url));
						return fetch(url, init);
					},
				}),
			).toEqual({ code: 1, out: "", err: RUN_INIT });
			expect(fetched).toEqual([]);
			expect(home.readState()).toBe(state);
		});

		it.each([
			["ingest endpoint", "HARNESSFORCE_ENDPOINT"],
			["connection URL", "HARNESSFORCE_URL"],
		])("when the %s is not allowed", async (_, name) => {
			const { hf, run } = await setup();
			expect(
				await run({ env: { [name]: "http://ingest.example.test" } }),
			).toEqual({
				code: 1,
				out: "",
				err: "接続先のURLが不正です\n",
			});
			expect(hf.requests).toEqual([]);
		});

		it.each([
			[
				"the repository list is unauthorized",
				{ repositories: () => ({ status: 401 }) },
				EXPIRED,
			],
			[
				"the workspace is unauthorized",
				{ workspace: { status: 401 } },
				EXPIRED,
			],
			[
				"the repository list fails",
				{ repositories: () => ({ status: 500 }) },
				READ_FAILED,
			],
			[
				"a later repository page fails",
				{
					repositories: (cursor: string | null) =>
						cursor
							? { status: 503 }
							: { status: 200, body: { data: [], next_cursor: "p2" } },
				},
				READ_FAILED,
			],
		])("when %s", async (_, options, err) => {
			const { hf, home, run } = await setup(options);
			expect(await run()).toEqual({ code: 1, out: "", err });
			expect(hf.sessionBodies()).toEqual([]);
			expect(home.readState()).toBeUndefined();
		});
	});

	// correlation.md「ApiTokenの失効」。
	describe("ApiToken refresh", () => {
		it("refreshes on a 401, retries and stores the new pair", async () => {
			const { hf, keychain, run } = await setup({
				unauthorizedTokens: ["hf_at_ws1_current"],
			});
			expect(await run()).toMatchObject({ code: 0 });
			expect(hf.sessionBodies()).toEqual([["s000"]]);
			expect(keychain.items.get("ws1:api-token")).toBe(
				storedToken("ws1", "refreshed"),
			);
			expect(
				hf.requests
					.filter((r) => r.path.startsWith("GET /app/api/v1/repositories"))
					.map((r) => r.headers.authorization),
			).toEqual(["Bearer hf_at_ws1_current", "Bearer hf_at_ws1_refreshed"]);
		});

		it("refreshes an expired access token before reading", async () => {
			const { hf, keychain, run } = await setup();
			keychain.items.set(
				"ws1:api-token",
				storedToken("ws1", "current", new Date(NOW).toISOString()),
			);
			expect(await run()).toMatchObject({ code: 0 });
			expect(hf.requests[0]?.path).toBe(
				"GET /.well-known/oauth-authorization-server/app",
			);
			expect(
				hf.requests.find((r) => r.path.startsWith("GET /app/api/v1/"))?.headers
					.authorization,
			).toBe("Bearer hf_at_ws1_refreshed");
		});

		it("stops as expired without sending when the refresh is rejected", async () => {
			const { hf, home, run } = await setup({
				unauthorizedTokens: ["hf_at_ws1_current"],
				refresh: { status: 400, body: { error: "invalid_grant" } },
			});
			expect(await run()).toEqual({ code: 1, out: "", err: EXPIRED });
			expect(hf.sessionBodies()).toEqual([]);
			expect(home.readState()).toBeUndefined();
		});

		it("treats an ApiToken stored by an older hf init as missing", async () => {
			const { hf, keychain, run } = await setup();
			keychain.items.set("ws1:api-token", "hf_at_ws1_plain");
			expect(await run()).toEqual({ code: 1, out: "", err: RUN_INIT });
			expect(hf.requests).toEqual([]);
		});
	});

	it("tells to run hf init when the ingest key is revoked", async () => {
		const { home, run } = await setup({ ingest: [{ status: 401 }] });
		expect(await run()).toEqual({
			code: 1,
			out: "",
			err: "送信キーが失効しています。`hf init`を実行してください\n",
		});
		expect(home.readState()).toBeUndefined();
	});

	it("resumes from the failed batch after 429 persists through three resends", async () => {
		const busy = { status: 429, headers: { "retry-after": "2" } };
		const { hf, run } = await setup(
			{
				ingest: [
					{ status: 200, body: { accepted: 100, rejected: [] } },
					busy,
					busy,
					busy,
					busy,
				],
			},
			150,
		);
		const sleeps: number[] = [];
		expect(
			await run({
				sleep: async (ms) => {
					sleeps.push(ms);
				},
			}),
		).toEqual({ code: 1, out: "", err: SEND_FAILED });
		expect(sleeps).toEqual([2000, 2000, 2000]);
		expect(await run()).toMatchObject({
			code: 0,
			out: "50件のsessionを取り込みました\n",
		});
		expect(hf.sessionBodies().map((b) => b.length)).toEqual([
			100, 50, 50, 50, 50, 50,
		]);
	});

	it("keeps sessions accepted before a 500 and does not resend them", async () => {
		const { hf, run } = await setup(
			{
				ingest: [
					{ status: 200, body: { accepted: 100, rejected: [] } },
					{ status: 500 },
				],
			},
			150,
		);
		expect(await run()).toEqual({ code: 1, out: "", err: SEND_FAILED });
		await run();
		expect(hf.sessionBodies().map((b) => b.length)).toEqual([100, 50, 50]);
	});

	it("leaves sessions dropped by the monthly limit for the next import", async () => {
		const { hf, run } = await setup(
			{
				ingest: [
					{
						status: 200,
						body: {
							accepted: 98,
							rejected: [
								{ index: 3, reason: "monthly_event_limit" },
								{ index: 4, reason: "monthly_event_limit" },
							],
						},
					},
				],
			},
			150,
		);
		expect(await run()).toEqual({
			code: 1,
			out: "",
			err: "月間イベント数の上限に達したため、52件のsessionを取り込めませんでした。上限が解除された後に`hf import`を再実行すると続きから取り込みます\n",
		});
		expect(await run()).toMatchObject({
			code: 0,
			out: "52件のsessionを取り込みました\n",
		});
		expect(hf.sessionBodies()[1]?.slice(0, 2)).toEqual(["s003", "s004"]);
	});

	it("reports a read-only workspace", async () => {
		const { run } = await setup({
			ingest: [
				{
					status: 200,
					body: {
						accepted: 0,
						rejected: [{ index: 0, reason: "workspace_read_only" }],
					},
				},
			],
		});
		expect(await run()).toMatchObject({
			code: 1,
			err: "Workspaceが閲覧のみのため、1件のsessionを取り込めませんでした。閲覧のみが解除された後に`hf import`を再実行すると続きから取り込みます\n",
		});
	});

	it("does not resend sessions rejected by the schema and still succeeds", async () => {
		const { hf, home, run } = await setup({
			ingest: [
				{
					status: 200,
					body: {
						accepted: 0,
						rejected: [{ index: 0, reason: "invalid: model" }],
					},
				},
			],
		});
		const broken = `{broken\n`;
		writeFileSync(
			join(home.home, ".claude/projects/-work-web/broken.jsonl"),
			broken,
		);
		expect(await run()).toEqual({
			code: 0,
			out: "読めなかった1行と0個のfileを読み飛ばしました\n0件のsessionを取り込みました\n形式が不正なため1件のsessionを取り込めませんでした\n",
			err: "",
		});
		await run();
		expect(hf.sessionBodies()).toEqual([["s000"]]);
	});

	it("stops when the state file cannot be saved", async () => {
		const { home, run } = await setup();
		// directoryを作れないように、同じ名前のfileを置く。
		writeFileSync(join(home.home, ".harnessforce"), "");
		expect(await run()).toEqual({
			code: 1,
			out: "",
			err: "取り込みの状態を保存できませんでした\n",
		});
	});
});
