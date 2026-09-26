import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CliDeps } from "../../src/main.js";
import type { Launch } from "../../src/run/launch.js";
import { makeHome } from "../init/harness.js";
import { fakeKeychain, runCli } from "../support/cli.js";
import { issueBody, type Reply, startReadApi } from "./read-api.js";

const INGEST = "https://ingest.example.test/base";
const pinnedKeychain = (extra: Record<string, string | undefined> = {}) =>
	fakeKeychain({
		items: Object.fromEntries(
			Object.entries({
				"ws1:ingest-key": "hf_ik_ws1_key",
				"ws1:api-token": "hf_at_token",
				"ws1:ingest-origin": "https://ingest.example.test",
				...extra,
			}).filter((entry): entry is [string, string] => entry[1] !== undefined),
		),
	});

type Setup = {
	issue?: (identifier: string) => Reply;
	list?: (query: string | null) => Reply;
	env?: Record<string, string>;
	settings?: string;
	keychain?: CliDeps["keychain"];
	exitCode?: number;
};

async function runHf(argv: string[], setup: Setup = {}) {
	const api = await startReadApi({
		issue:
			setup.issue ??
			((id) => ({ status: 200, body: issueBody(id) }) satisfies Reply),
		list: setup.list,
	});
	const home = makeHome(setup.settings);
	const launches: Launch[] = [];
	const result = await runCli(["run", ...argv], {
		env: {
			HARNESSFORCE_URL: api.base,
			HARNESSFORCE_ENDPOINT: INGEST,
			HARNESSFORCE_WORKSPACE_ID: "ws1",
			...setup.env,
		},
		homeDir: home.home,
		keychain: setup.keychain ?? pinnedKeychain().keychain,
		// repositoryの外（gitの応答なし）で、構成も無い。
		cwd: home.home,
		git: async () => undefined,
		now: () => new Date(0),
		launch: async (launch) => {
			launches.push(launch);
			return { kind: "exited", code: setup.exitCode ?? 0 };
		},
	});
	return { ...result, launches, api };
}

const ISSUE_ARGS = ["--issue", "ENG-42", "--", "claude", "-p", "hi"];

describe("hf run", () => {
	it("launches the agent with the issue attribute and returns its exit code", async () => {
		const r = await runHf(ISSUE_ARGS, { exitCode: 3 });
		expect(r.code).toBe(3);
		expect(r.err).toBe("");
		expect(r.launches).toHaveLength(1);
		const [launch] = r.launches;
		expect(launch?.command).toBe("claude");
		expect(launch?.args.slice(2)).toEqual(["-p", "hi"]);
		expect(launch?.env).toMatchObject({
			HARNESSFORCE_ISSUE: "ENG-42",
			HARNESSFORCE_WORKSPACE_ID: "ws1",
			HARNESSFORCE_ENDPOINT: INGEST,
			OTEL_EXPORTER_OTLP_ENDPOINT: INGEST,
			OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer hf_ik_ws1_key",
			OTEL_RESOURCE_ATTRIBUTES: "hf.issue.identifier=ENG-42",
		});
		expect(r.api.requests[0]?.headers.authorization).toBe("Bearer hf_at_token");
	});

	it("uses the user settings when the shell has no destinations", async () => {
		const api = await startReadApi({
			issue: () => ({ status: 200, body: issueBody("ENG-42") }),
		});
		const r = await runHf(ISSUE_ARGS, {
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
		const other = pinnedKeychain({
			"ws2:ingest-key": "hf_ik_ws2_key",
			"ws2:api-token": "hf_at_ws2",
			"ws2:ingest-origin": "https://ingest.ws2.test",
		});
		const r = await runHf(ISSUE_ARGS, {
			keychain: other.keychain,
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
		const settings = JSON.parse(r.launches[0]?.args[1] ?? "");
		expect(settings.env).toMatchObject({
			HARNESSFORCE_WORKSPACE_ID: "ws2",
			HARNESSFORCE_ENDPOINT: "https://ingest.ws2.test",
			OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer hf_ik_ws2_key",
		});
		expect(r.api.requests[0]?.headers.authorization).toBe("Bearer hf_at_ws2");
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

	describe("terminals before launch", () => {
		const cases: [string, Setup, string, string[]?][] = [
			[
				"keychain unavailable",
				{ keychain: fakeKeychain({ available: false }).keychain },
				"OSのキーチェーンを利用できないため、送信キーを保存できません",
			],
			[
				"keychain read failure",
				{ keychain: fakeKeychain({ failRead: true }).keychain },
				"OSのキーチェーンを利用できないため、送信キーを保存できません",
			],
			[
				"no ingest endpoint",
				{ env: { HARNESSFORCE_ENDPOINT: "" } },
				"`hf init`を実行してください",
			],
			[
				"no workspace",
				{ env: { HARNESSFORCE_WORKSPACE_ID: "" } },
				"`hf init`を実行してください",
			],
			[
				"an ingest endpoint over plain http",
				{ env: { HARNESSFORCE_ENDPOINT: "http://ingest.example.test" } },
				"接続先のURLが不正です",
			],
			[
				"no user ingest key",
				{ keychain: pinnedKeychain({ "ws1:ingest-key": undefined }).keychain },
				"`hf init`を実行してください",
			],
			[
				"an invalid identifier",
				{},
				"Issueの識別子が不正です",
				["--issue", "ENG 42", "--", "claude"],
			],
			[
				"no ApiToken",
				{ keychain: pinnedKeychain({ "ws1:api-token": undefined }).keychain },
				"Issueを解決できませんでした。`hf init`を実行してください",
			],
			[
				"a 401 on resolution",
				{ issue: () => ({ status: 401 }) },
				"Issueを解決できませんでした。`hf init`を実行してください",
			],
			[
				"a 401 on candidates",
				{ issue: () => ({ status: 404 }), list: () => ({ status: 401 }) },
				"Issueを解決できませんでした。`hf init`を実行してください",
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
			[
				"no pinned origin",
				{
					keychain: pinnedKeychain({ "ws1:ingest-origin": undefined }).keychain,
				},
				"`hf init`を実行してください",
			],
			[
				"an endpoint outside the pinned origin",
				{ env: { HARNESSFORCE_ENDPOINT: "https://attacker.example.test" } },
				"`hf init`を実行してください",
			],
		];

		it.each(cases)("stops on %s", async (_, setup, message, argv) => {
			const r = await runHf(argv ?? ISSUE_ARGS, setup);
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
			"Issueを解決できませんでした。候補:\n  ENG-420  Login\n  ENG-421\n",
		);
		expect(r.launches).toEqual([]);
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
			keychain: pinnedKeychain().keychain,
			cwd: join(home.home, "nowhere"),
			git: async () => undefined,
			now: () => new Date(0),
			launch: async () => ({ kind: "failed" }),
		});
		expect(r.code).toBe(1);
		expect(r.err).toBe("claudeを起動できませんでした\n");
	});
});
