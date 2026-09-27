import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CliDeps } from "../../src/main.js";
import type { Launch } from "../../src/run/launch.js";
import { makeHome } from "../init/harness.js";
import { fakeKeychain, runCli } from "../support/cli.js";
import {
	issueBody,
	type Reply,
	startReadApi,
	storedToken,
} from "./read-api.js";

const INGEST = "https://ingest.example.test/base";
// Read APIはtestごとに空いているportで待ち受けるため、url-originはそのoriginを受け取って作る。
const pinnedKeychain =
	(extra: Record<string, string | undefined> = {}) =>
	(apiOrigin: string) =>
		fakeKeychain({
			items: Object.fromEntries(
				Object.entries({
					"ws1:ingest-key": "hf_ik_ws1_key",
					"ws1:api-token": storedToken("ws1", "token"),
					"ws1:ingest-origin": "https://ingest.example.test",
					"ws1:url-origin": apiOrigin,
					...extra,
				}).filter((entry): entry is [string, string] => entry[1] !== undefined),
			),
		}).keychain;

type Setup = {
	issue?: (identifier: string) => Reply;
	list?: (query: string | null) => Reply;
	refresh?: Reply;
	env?: Record<string, string>;
	settings?: string;
	keychain?: (apiOrigin: string) => CliDeps["keychain"];
	exitCode?: number;
	restoredEnv?: Record<string, string>;
};

async function runHf(argv: string[], setup: Setup = {}) {
	const api = await startReadApi({
		issue:
			setup.issue ??
			((id) => ({ status: 200, body: issueBody(id) }) satisfies Reply),
		list: setup.list,
		refresh: setup.refresh,
	});
	const home = makeHome(setup.settings);
	const launches: Launch[] = [];
	// Read APIとingestのどちらにも送っていないことを確かめるため、すべての要求を記録する。
	const fetched: string[] = [];
	const result = await runCli(["run", ...argv], {
		env: {
			HARNESSFORCE_URL: api.base,
			HARNESSFORCE_ENDPOINT: INGEST,
			HARNESSFORCE_WORKSPACE_ID: "ws1",
			...setup.env,
		},
		homeDir: home.home,
		keychain: (setup.keychain ?? pinnedKeychain())(new URL(api.base).origin),
		fetch: (url, init) => {
			fetched.push(String(url));
			return fetch(url, init);
		},
		// repositoryの外（gitの応答なし）で、構成も無い。
		cwd: home.home,
		git: async () => undefined,
		now: () => new Date(0),
		restoredEnv: setup.restoredEnv ?? {},
		launch: async (launch) => {
			launches.push(launch);
			return { kind: "exited", code: setup.exitCode ?? 0 };
		},
	});
	return { ...result, launches, api, fetched };
}

const ISSUE_ARGS = ["--issue", "ENG-42", "--", "claude", "-p", "hi"];

describe("hf run", () => {
	// correlation.md「Node.jsの実行時の変数」: agentには起動し直す前に取り除いた値を戻す。
	it("gives the agent the Node runtime variables removed before the relaunch", async () => {
		const r = await runHf(ISSUE_ARGS, {
			restoredEnv: {
				HTTPS_PROXY: "http://corp:8080",
				NODE_EXTRA_CA_CERTS: "/etc/corp.pem",
			},
		});
		expect(r.code).toBe(0);
		expect(r.launches[0]?.env).toMatchObject({
			HTTPS_PROXY: "http://corp:8080",
			NODE_EXTRA_CA_CERTS: "/etc/corp.pem",
		});
		expect(r.launches[0]?.settingsEnv).not.toHaveProperty("HTTPS_PROXY");
	});

	it("launches the agent with the issue attribute and returns its exit code", async () => {
		const r = await runHf(ISSUE_ARGS, { exitCode: 3 });
		expect(r.code).toBe(3);
		expect(r.err).toBe("");
		expect(r.launches).toHaveLength(1);
		const [launch] = r.launches;
		expect(launch?.command).toBe("claude");
		expect(launch?.args).toEqual(["-p", "hi"]);
		expect(launch?.env).toMatchObject({
			HARNESSFORCE_ISSUE: "ENG-42",
			HARNESSFORCE_WORKSPACE_ID: "ws1",
			HARNESSFORCE_ENDPOINT: INGEST,
			OTEL_EXPORTER_OTLP_ENDPOINT: INGEST,
			OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
			OTEL_RESOURCE_ATTRIBUTES: "hf.issue.identifier=ENG-42",
		});
		expect(launch?.settingsEnv).toMatchObject({
			HARNESSFORCE_ISSUE: "ENG-42",
			HARNESSFORCE_WORKSPACE_ID: "ws1",
		});
		expect(r.api.requests[0]?.headers.authorization).toBe(
			"Bearer hf_at_ws1_token",
		);
	});

	// keyはotelHeadersHelperを通してだけClaude Codeへ届く。
	it("puts neither the user key nor the ApiToken in the environment, args or settings", async () => {
		const r = await runHf(ISSUE_ARGS, {
			env: { OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer other" },
		});
		expect(r.code).toBe(0);
		const launch = JSON.stringify(r.launches);
		expect(launch).not.toContain("hf_ik_ws1_key");
		expect(launch).not.toContain("hf_at_ws1_token");
		expect(launch).not.toContain("hf_rt_ws1_token");
		expect(launch).not.toContain("Bearer");
		expect(r.launches[0]?.env).not.toHaveProperty("OTEL_EXPORTER_OTLP_HEADERS");
	});

	it("uses the user settings when the shell has no destinations", async () => {
		const api = await startReadApi({
			issue: () => ({ status: 200, body: issueBody("ENG-42") }),
		});
		const r = await runHf(ISSUE_ARGS, {
			keychain: () => pinnedKeychain()(new URL(api.base).origin),
			env: {
				HARNESSFORCE_URL: "",
				HARNESSFORCE_ENDPOINT: "",
				HARNESSFORCE_WORKSPACE_ID: "",
			},
			settings: JSON.stringify({
				env: {
					HARNESSFORCE_URL: api.base,
					HARNESSFORCE_ENDPOINT: "https://ingest.example.test/other",
					HARNESSFORCE_WORKSPACE_ID: "ws1",
				},
			}),
		});
		expect(r.code).toBe(0);
		expect(api.requests).toHaveLength(1);
		expect(r.launches[0]?.env.HARNESSFORCE_ENDPOINT).toBe(
			"https://ingest.example.test/other",
		);
	});

	it("prefers the shell workspace and endpoint over user settings", async () => {
		const r = await runHf(ISSUE_ARGS, {
			keychain: (apiOrigin) =>
				pinnedKeychain({
					"ws2:ingest-key": "hf_ik_ws2_key",
					"ws2:api-token": storedToken("ws2", "token"),
					"ws2:ingest-origin": "https://ingest.ws2.test",
					"ws2:url-origin": apiOrigin,
				})(apiOrigin),
			env: {
				HARNESSFORCE_WORKSPACE_ID: "ws2",
				HARNESSFORCE_ENDPOINT: "https://ingest.ws2.test",
			},
			settings: JSON.stringify({
				env: {
					HARNESSFORCE_ENDPOINT: INGEST,
					HARNESSFORCE_WORKSPACE_ID: "ws1",
				},
			}),
		});
		expect(r.code).toBe(0);
		expect(r.launches[0]?.settingsEnv).toMatchObject({
			HARNESSFORCE_WORKSPACE_ID: "ws2",
			HARNESSFORCE_ENDPOINT: "https://ingest.ws2.test",
		});
		expect(r.api.requests[0]?.headers.authorization).toBe(
			"Bearer hf_at_ws2_token",
		);
	});

	it.each([
		[[]],
		[["--issue", "ENG-1"]],
		[["--issue", "ENG-1", "--"]],
		[["--issue", "ENG-1", "claude"]],
		[["ENG-1", "--", "claude"]],
	])("rejects %j with usage", async (argv) => {
		const r = await runHf(argv);
		expect(r.code).toBe(1);
		expect(r.err).toContain("Usage: hf");
		expect(r.launches).toEqual([]);
	});

	// correlation.md「CLI」の確かめる順1〜8。どれもRead APIとingestへ何も送らない。
	describe("checks before the Issue is resolved", () => {
		const INIT = "`hf init`を実行してください";
		const KEYCHAIN =
			"OSのキーチェーンを利用できないため、送信キーを保存できません";
		const INVALID_URL = "接続先のURLが不正です";
		const NO_TOKEN = "Issueを解決できませんでした。`hf init`を実行してください";
		const cases: [string, Setup, string, string[]?][] = [
			[
				"1: keychain unavailable",
				{ keychain: () => fakeKeychain({ available: false }).keychain },
				KEYCHAIN,
			],
			[
				"1: keychain read failure",
				{ keychain: () => fakeKeychain({ failRead: true }).keychain },
				KEYCHAIN,
			],
			[
				"2: no workspace, before an invalid Read API URL",
				{
					env: {
						HARNESSFORCE_WORKSPACE_ID: "",
						HARNESSFORCE_URL: "http://app.example.test",
					},
				},
				INIT,
			],
			[
				"3: no user ingest key, before a missing ingest endpoint",
				{
					keychain: pinnedKeychain({ "ws1:ingest-key": undefined }),
					env: { HARNESSFORCE_ENDPOINT: "" },
				},
				INIT,
			],
			["4: no ingest endpoint", { env: { HARNESSFORCE_ENDPOINT: "" } }, INIT],
			[
				"4: an ingest endpoint over plain http",
				{ env: { HARNESSFORCE_ENDPOINT: "http://ingest.example.test" } },
				INVALID_URL,
			],
			[
				"5: no pinned ingest origin",
				{ keychain: pinnedKeychain({ "ws1:ingest-origin": undefined }) },
				INIT,
			],
			[
				"5: an ingest endpoint outside the pinned origin, before a missing ApiToken",
				{
					env: { HARNESSFORCE_ENDPOINT: "https://attacker.example.test" },
					keychain: pinnedKeychain({ "ws1:api-token": undefined }),
				},
				INIT,
			],
			[
				"6: no ApiToken, before an invalid Read API URL",
				{
					keychain: pinnedKeychain({ "ws1:api-token": undefined }),
					env: { HARNESSFORCE_URL: "http://app.example.test" },
				},
				NO_TOKEN,
			],
			[
				"7: a Read API URL over plain http",
				{ env: { HARNESSFORCE_URL: "http://app.example.test" } },
				INVALID_URL,
			],
			[
				"8: no pinned Read API origin",
				{ keychain: pinnedKeychain({ "ws1:url-origin": undefined }) },
				INIT,
			],
			[
				"8: a Read API URL outside the pinned origin",
				{ env: { HARNESSFORCE_URL: "https://attacker.example.test" } },
				INIT,
			],
			[
				"8: before an invalid identifier",
				{ keychain: pinnedKeychain({ "ws1:url-origin": undefined }) },
				INIT,
				["--issue", "ENG 42", "--", "claude"],
			],
			[
				"an invalid identifier",
				{},
				"Issueの識別子が不正です",
				["--issue", "ENG 42", "--", "claude"],
			],
		];

		it.each(cases)("stops on %s", async (_, setup, message, argv) => {
			const r = await runHf(argv ?? ISSUE_ARGS, setup);
			expect(r.code).not.toBe(0);
			expect(r.err).toBe(`${message}\n`);
			expect(r.out).toBe("");
			expect(r.fetched).toEqual([]);
			expect(r.launches).toEqual([]);
		});
	});

	// correlation.md「ApiTokenの失効」。
	it("refreshes an expired access token, resolves the Issue with the new token and launches", async () => {
		const r = await runHf(ISSUE_ARGS, {
			issue: () => ({ status: 200, body: issueBody("ENG-42") }),
			keychain: (apiOrigin) =>
				pinnedKeychain({
					"ws1:api-token": storedToken("ws1", "token", "1970-01-01T00:00:00Z"),
				})(apiOrigin),
		});
		expect(r.code).toBe(0);
		expect(r.api.requests.map((q) => q.headers.authorization)).toEqual([
			undefined,
			undefined,
			"Bearer hf_at_ws1_refreshed",
		]);
		expect(r.launches).toHaveLength(1);
	});

	describe("terminals of the Issue resolution", () => {
		const cases: [string, Setup, string][] = [
			[
				"a 401 on resolution that persists after the refresh",
				{ issue: () => ({ status: 401 }) },
				"ログインの有効期限が切れました。`hf init`を実行してください",
			],
			[
				"a 401 on candidates that persists after the refresh",
				{ issue: () => ({ status: 404 }), list: () => ({ status: 401 }) },
				"ログインの有効期限が切れました。`hf init`を実行してください",
			],
			[
				"a rejected refresh after a 401",
				{
					issue: () => ({ status: 401 }),
					refresh: { status: 400, body: { error: "invalid_grant" } },
				},
				"ログインの有効期限が切れました。`hf init`を実行してください",
			],
			[
				"a 500 on resolution",
				{ issue: () => ({ status: 500 }) },
				"Issueを解決できず、候補も取得できませんでした",
			],
			[
				"a 500 on candidates",
				{ issue: () => ({ status: 404 }), list: () => ({ status: 500 }) },
				"Issueを解決できず、候補も取得できませんでした",
			],
			[
				"no candidates",
				{ issue: () => ({ status: 404 }) },
				"一致するIssueがありません",
			],
		];

		it.each(cases)("stops on %s", async (_, setup, message) => {
			const r = await runHf(ISSUE_ARGS, setup);
			expect(r.code).not.toBe(0);
			expect(r.err).toBe(`${message}\n`);
			expect(r.out).toBe("");
			expect(r.launches).toEqual([]);
		});
	});

	it("does not call the Read API with an invalid identifier", async () => {
		const r = await runHf(["--issue", "", "--", "claude"]);
		expect(r.err).toBe("Issueの識別子が不正です\n");
		expect(r.api.requests).toEqual([]);
	});

	it("lists candidates when the issue does not resolve", async () => {
		const r = await runHf(ISSUE_ARGS, {
			issue: () => ({ status: 404 }),
			list: () => ({
				status: 200,
				body: {
					data: [issueBody("ENG-420", "Login"), issueBody("ENG-421", "")],
					next_cursor: null,
				},
			}),
		});
		expect(r.code).toBe(1);
		expect(r.err).toBe(
			"Issueを解決できませんでした。候補:\nENG-420  Login\nENG-421  \n",
		);
		expect(r.launches).toEqual([]);
	});

	it("does not print terminal control characters from candidate titles", async () => {
		const r = await runHf(ISSUE_ARGS, {
			issue: () => ({ status: 404 }),
			list: () => ({
				status: 200,
				body: {
					data: [
						issueBody("ENG-\u001b[2J1", "Log\u001b]0;x\u0007in\n\t\u009bbad"),
					],
					next_cursor: null,
				},
			}),
		});
		expect(r.err).toBe(
			"Issueを解決できませんでした。候補:\nENG-[2J1  Log]0;xinbad\n",
		);
	});

	it("reports a launch failure", async () => {
		const home = makeHome();
		const api = await startReadApi({
			issue: () => ({ status: 200, body: issueBody("ENG-42") }),
		});
		const r = await runCli(["run", ...ISSUE_ARGS], {
			env: {
				HARNESSFORCE_URL: api.base,
				HARNESSFORCE_ENDPOINT: INGEST,
				HARNESSFORCE_WORKSPACE_ID: "ws1",
			},
			homeDir: home.home,
			keychain: pinnedKeychain()(new URL(api.base).origin),
			cwd: join(home.home, "nowhere"),
			git: async () => undefined,
			now: () => new Date(0),
			launch: async () => ({ kind: "failed" }),
		});
		expect(r.code).toBe(1);
		expect(r.err).toBe("claudeを起動できませんでした\n");
	});
});
