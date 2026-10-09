import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCHEMAS } from "@harnessforce/semconv";
import { compileSchema } from "@harnessforce/test-support/validator";
import { describe, expect, it } from "vitest";
import {
	MARKER,
	NOW,
	setupTune,
	snapshotTree,
	tuneTranscript,
	writeFile,
} from "./harness.js";

const INIT =
	"`harnessforce init`を実行してください。Viewerのロールでは`harnessforce tune`を利用できません\n";
const isValidReport = compileSchema(SCHEMAS["analysis-report"]);

describe("harnessforce tune", () => {
	it("imports first, then sends schema-only reports without any prompt text", async () => {
		const t = await setupTune();
		const result = await t.run();
		expect(result).toMatchObject({
			code: 0,
			err: "10件の分析結果を送信しました\n",
		});
		expect(result.out).toContain("分析したsession: 10件");
		expect(result.out).toContain("approval: 未計測");
		expect(result.out).toContain("continue: 10回");
		const paths = t.hf.requests.map((r) => r.path);
		expect(paths.indexOf("POST /ingest/v1/imports/sessions")).toBeLessThan(
			paths.indexOf("POST /ingest/v1/analysis-reports"),
		);
		for (const request of t.hf.requests)
			expect(JSON.stringify(request.body ?? "")).not.toContain(MARKER);
		const [reports] = t.reportBodies();
		expect(reports).toHaveLength(10);
		for (const report of reports ?? [])
			expect(isValidReport(report)).toBe(true);
		const auth = t.hf.requests.find(
			(r) => r.path === "POST /ingest/v1/analysis-reports",
		)?.headers.authorization;
		expect(auth).toBe("Bearer hf_ik_ws1_user");
	});

	it("does not duplicate a session when it is analyzed and sent twice", async () => {
		const t = await setupTune();
		await t.run();
		await t.run();
		const [first, second] = t.reportBodies();
		expect(second).toEqual(first);
		// 2回目は取り込み済みのsessionを取り込み直さない。
		expect(t.hf.sessionBodies()).toEqual([
			Array.from({ length: 10 }, (_, i) => `s${String(i).padStart(3, "0")}`),
		]);
	});

	it("guides harnessforce init and sends nothing on a terminal without harnessforce init", async () => {
		const t = await setupTune();
		const result = await t.run([], {
			keychain: (await import("../support/cli.js")).fakeKeychain().keychain,
		});
		expect(result).toEqual({ code: 1, out: "", err: INIT });
		expect(t.hf.requests).toEqual([]);
		expect(existsSync(t.tuneDir)).toBe(false);
	});

	it("says there is too little data for fewer than 10 sessions", async () => {
		const t = await setupTune({ sessions: 7 });
		const result = await t.run();
		expect(result.code).toBe(0);
		expect(result.err).toContain(
			"データ不足: 分析したsessionは7件です。提案には10件以上が必要です（あと3件）\n",
		);
	});

	it("keeps unreachable reports and sends them on the next run", async () => {
		const t = await setupTune({ analysis: [{ status: 503 }] });
		const first = await t.run();
		expect(first.code).toBe(0);
		expect(first.out).toContain("分析したsession: 10件");
		expect(first.err).toContain(
			"Harnessforceへ送信できませんでした。10件の分析結果は次の実行で送ります\n",
		);
		expect(t.readTune("unsent.json").destinations).not.toEqual({});
		// 記録のfileが消えても、未送信の分は次の実行で送る。
		rmSync(join(t.home.home, ".claude", "projects"), { recursive: true });
		const second = await t.run();
		expect(second.err).toContain("10件の分析結果を送信しました\n");
		expect(t.reportBodies()[1]).toEqual(t.reportBodies()[0]);
		expect(t.readTune("unsent.json").destinations).toEqual({});
	});

	it.each([
		401, 403,
	])("deletes the unsent reports and guides harnessforce init on %i", async (status) => {
		const t = await setupTune({ analysis: [{ status: 503 }, { status }] });
		await t.run();
		const result = await t.run();
		expect(result.code).toBe(3);
		expect(result.out).toContain("分析したsession: 10件");
		expect(result.err).toContain(
			"送信キーを使えません。未送信の分析結果10件を削除しました。`harnessforce init`を実行してください\n",
		);
		expect(t.readTune("unsent.json").destinations).toEqual({});
	});

	it("does not resend unsent reports of a repository that is no longer connected", async () => {
		let isConnected = true;
		const t = await setupTune({
			analysis: [{ status: 503 }],
			repositories: () => ({
				status: 200,
				body: {
					items: isConnected ? [{ repository: "github.com/acme/web" }] : [],
					next_cursor: null,
				},
			}),
		});
		await t.run();
		isConnected = false;
		const result = await t.run();
		expect(result.code).toBe(0);
		expect(t.reportBodies()).toHaveLength(1);
		expect(t.readTune("unsent.json").destinations).not.toEqual({});
	});

	it("deletes unsent reports once each when the pre-send import gets 401", async () => {
		const t = await setupTune({
			analysis: [{ status: 503 }],
			ingest: [
				{ status: 200, body: { accepted: 10, rejected: [] } },
				{ status: 401 },
			],
		});
		await t.run();
		// 新しいsessionを取り込ませるため、取り込みの状態を消す。
		rmSync(join(t.home.home, ".harnessforce", "import-state.json"));
		const result = await t.run();
		expect(result.code).toBe(3);
		expect(result.err).toContain(
			"送信キーを使えません。未送信の分析結果10件を削除しました。`harnessforce init`を実行してください\n",
		);
		expect(t.reportBodies()).toHaveLength(1);
		expect(t.readTune("unsent.json").destinations).toEqual({});
	});

	it("drops rejected elements except read-only ones, and drops other 4xx requests", async () => {
		const t = await setupTune({
			sessions: 3,
			analysis: [
				{
					status: 200,
					body: {
						accepted: 1,
						rejected: [
							{ index: 0, reason: "workspace_read_only" },
							{ index: 1, reason: "invalid_element", field: "loops" },
						],
					},
				},
			],
		});
		const result = await t.run();
		expect(result.err).toContain(
			"Workspaceが閲覧のみのため、1件の分析結果を送信できませんでした。次の実行で送ります\n",
		);
		expect(result.err).toContain(
			"形式が不正なため1件の分析結果を送信せずに削除しました（invalid_element）\n",
		);
		const t2 = await setupTune({ sessions: 2, analysis: [{ status: 413 }] });
		expect((await t2.run()).err).toContain(
			"Harnessforceが送信を拒否しました（HTTP 413）。2件の分析結果を送信せずに削除しました\n",
		);
		expect(t2.readTune("unsent.json").destinations).toEqual({});
	});

	it("does not send sessions older than the Free session_import_days", async () => {
		const t = await setupTune({
			workspace: { status: 200, body: { session_import_days: 14 } },
			startedDaysAgo: (i) => (i < 3 ? 20 : 2),
		});
		const result = await t.run();
		expect(result.err).toContain(
			"送信の範囲外: 開始が14日より前の3件のsessionは送信しません\n",
		);
		expect(t.reportBodies()[0]).toHaveLength(7);
	});

	it("never sends sessions of a repository that is not connected, even with --all", async () => {
		const t = await setupTune({ remote: "git@github.com:acme/other.git" });
		const result = await t.run(["--all"]);
		expect(result.code).toBe(0);
		expect(result.err).toContain(
			"接続済みでないrepositoryの10件のsessionは送信しません\n",
		);
		expect(t.reportBodies()).toEqual([]);
		// --allを付けなければ、未接続のsessionは分析しない。
		expect((await t.run()).out).toContain("分析したsession: 0件");
	});

	it("shows the analysis and sends nothing without a list or a saved list", async () => {
		const t = await setupTune({ repositories: () => ({ status: 503 }) });
		const result = await t.run();
		expect(result.code).toBe(0);
		expect(result.out).toContain("分析したsession: 10件");
		expect(result.err).toContain(
			"接続済みのrepositoryを確認できないため送信しません\n",
		);
		expect(
			t.hf.requests.filter((r) => r.path.startsWith("POST /ingest/")),
		).toEqual([]);
		expect(existsSync(join(t.tuneDir, "unsent.json"))).toBe(false);
	});

	it("uses the saved list without importing when the list cannot be fetched", async () => {
		let isDown = false;
		const t = await setupTune({
			repositories: () =>
				isDown
					? { status: 503 }
					: {
							status: 200,
							body: {
								items: [{ repository: "github.com/acme/web" }],
								next_cursor: null,
							},
						},
		});
		await t.run();
		isDown = true;
		rmSync(join(t.home.home, ".harnessforce", "import-state.json"));
		const result = await t.run();
		expect(result.err).toMatch(
			/接続済みのrepositoryの一覧を取得できないため、\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}に保存した一覧を使います\n/,
		);
		expect(t.reportBodies()).toHaveLength(2);
		expect(t.hf.sessionBodies()).toHaveLength(1);
	});

	it("refreshes the api token on a 401 from the list and continues", async () => {
		const t = await setupTune({ unauthorizedTokens: ["hf_at_ws1_current"] });
		const result = await t.run();
		expect(result.err).toContain("10件の分析結果を送信しました\n");
		expect(t.hf.requests.some((r) => r.path === "POST /app/oauth/token")).toBe(
			true,
		);
	});

	it("deletes the unsent reports and the saved list when refresh fails", async () => {
		let isRevoked = false;
		const t = await setupTune({
			analysis: [{ status: 503 }],
			refresh: { status: 400, body: { error: "invalid_grant" } },
			repositories: () =>
				isRevoked
					? { status: 401 }
					: {
							status: 200,
							body: {
								items: [{ repository: "github.com/acme/web" }],
								next_cursor: null,
							},
						},
		});
		await t.run();
		isRevoked = true;
		const result = await t.run();
		expect(result.code).toBe(3);
		expect(result.out).toContain("分析したsession: 10件");
		expect(result.err).toContain(
			"ログインの有効期限が切れました。`harnessforce init`を実行してください\n",
		);
		expect(t.readTune("unsent.json").destinations).toEqual({});
		expect(t.readTune("repositories.json").destinations).toEqual({});
		expect(t.reportBodies()).toHaveLength(1);
	});

	it.each([
		[
			'{"tune": {"send_report": false}}',
			"送信しない設定のため、分析結果を送信しません\n",
		],
		[
			'{"tune": {"send_report": "no"}}',
			"端末の設定（`~/.harnessforce/config.json`）を読めないため、分析結果を送信しません\n",
		],
	])("sends nothing with the terminal setting %s", async (config, message) => {
		const t = await setupTune();
		writeFile(join(t.home.home, ".harnessforce", "config.json"), config);
		const result = await t.run();
		expect(result).toMatchObject({ code: 0, err: message });
		expect(result.out).toContain("分析したsession");
		expect(t.hf.requests).toEqual([]);
	});

	it("sends nothing with --no-send whatever the terminal setting says", async () => {
		const t = await setupTune();
		mkdirSync(join(t.home.home, ".harnessforce"), { recursive: true });
		writeFileSync(
			join(t.home.home, ".harnessforce", "config.json"),
			'{"tune": {"send_report": true}}',
		);
		const result = await t.run(["--no-send", "--show-report"]);
		expect(result.err).toBe("送信しない設定のため、分析結果を送信しません\n");
		expect(t.hf.requests).toEqual([]);
	});

	it("writes one JSON object with --json, whose reports are what it sends", async () => {
		const t = await setupTune();
		const result = await t.run(["--json", "--show-report"]);
		const output = JSON.parse(result.out);
		expect(output).toMatchObject({
			analyzer_version: "1.1.0",
			parser_version: "1.1.0",
			session_count: 10,
			sufficient: true,
		});
		expect(output.sessions[0]).toMatchObject({
			session_id: "s000",
			repository: "github.com/acme/web",
			sendable: true,
		});
		expect(output.sessions.map((s: { report: unknown }) => s.report)).toEqual(
			t.reportBodies()[0],
		);
		expect(t.readTune("analysis.json").sessions).toEqual(output.sessions);
	});

	// improvement-loop.md「端末だけの値」と受入条件: 使い方は出力とanalysis.jsonに含めるが、送らない。
	it("adds the terminal-only usage to --json and analysis.json and sends none of it", async () => {
		const t = await setupTune();
		const compaction = (seconds: number) => ({
			type: "system",
			subtype: "compact_boundary",
			timestamp: new Date(NOW - 2 * 86_400_000 + seconds * 1000).toISOString(),
			compactMetadata: { trigger: "auto", preTokens: 150000, postTokens: 9000 },
		});
		writeFileSync(
			join(t.home.home, ".claude", "projects", "-work-web", "s000.jsonl"),
			tuneTranscript("s000", t.cwd, NOW - 2 * 86_400_000, [
				compaction(10),
				compaction(20),
			]),
		);
		const output = JSON.parse((await t.run(["--json"])).out);
		expect(output.sessions[0].usage).toEqual({
			compactions_auto: 2,
			compactions_manual: 0,
			responses: 2,
			// 記録のusageにcacheの項目が無く、割合を読めない。
			cache_reuse_ratio: null,
			models: [{ model: "claude-opus-5-5", responses: 2, output_tokens: 2 }],
			subagent_models: [],
			kinds: ["frequent_compaction"],
		});
		expect(output.sessions[1].usage.kinds).toEqual([]);
		expect(t.readTune("analysis.json").sessions).toEqual(output.sessions);
		const sent = t.hf.requests.filter((r) =>
			r.path.startsWith("POST /ingest/"),
		);
		expect(sent.map((r) => r.path)).toEqual([
			"POST /ingest/v1/imports/sessions",
			"POST /ingest/v1/analysis-reports",
		]);
		for (const request of sent)
			for (const word of [
				'"usage"',
				'"compactions_auto"',
				'"cache_reuse_ratio"',
				'"models"',
				"frequent_compaction",
			])
				expect(JSON.stringify(request.body)).not.toContain(word);
	});

	it("shows the sessions of each usage kind and the model shares of output tokens", async () => {
		const t = await setupTune();
		const result = await t.run();
		expect(result.out).toContain(
			"使い方（端末だけの値。送信しません）:\n  frequent_compaction: 0 session\n  low_cache_reuse: 0 session\n  model（output_tokensの割合）: 本体 claude-opus-5-5 100.0%\n",
		);
	});

	// improvement-loop.md「前回の提案の前後」: 後の期間が満了した前後は、--jsonで1回だけ出力する。
	it("outputs the before and after of a detected proposal and stops after --json outputs its ended period", async () => {
		const DAY_MS = 86_400_000;
		const t = await setupTune({
			sessions: 11,
			startedDaysAgo: (i) => (i < 6 ? 20 : 10),
		});
		const detectedAt = new Date(NOW - 15 * DAY_MS).toISOString();
		writeFile(
			join(t.tuneDir, "proposals.json"),
			JSON.stringify({
				version: 1,
				proposals: [
					{
						proposal_id: "p1",
						category: "intervention.kind=continue",
						change_type: "skill",
						scope: "user",
						path: join(t.home.home, ".claude", "skills", "go", "SKILL.md"),
						project_root: null,
						component: { kind: "skill", source: "user", id: "go" },
						expected_hash: "h",
						detects_applied: true,
						recorded_at: new Date(NOW - 16 * DAY_MS).toISOString(),
						evidence_session_ids: ["s000"],
						attribution: "decided",
						attributed_session_id: null,
						applied_detected_at: detectedAt,
					},
				],
			}),
		);
		const outputAt = () =>
			t.readTune("proposals.json").proposals[0].followup_output_at;
		await t.run(["--no-send"]);
		expect(outputAt()).toBeNull();
		const first = JSON.parse((await t.run(["--json", "--no-send"])).out);
		expect(first.followups).toEqual([
			expect.objectContaining({
				proposal_id: "p1",
				origin: detectedAt,
				before: expect.objectContaining({ sessions: 6, value: 1 }),
				after: expect.objectContaining({ sessions: 5, value: 1 }),
				no_comparison_data: false,
				before_outside_range: false,
			}),
		]);
		expect(outputAt()).toBe(new Date(NOW).toISOString());
		const second = JSON.parse((await t.run(["--json", "--no-send"])).out);
		expect(second.followups).toEqual([]);
	});

	it("changes no file outside ~/.harnessforce/tune/ except the import state", async () => {
		const t = await setupTune();
		const isOwnState = (path: string) =>
			path.startsWith(join(".harnessforce", "tune")) ||
			path === join(".harnessforce", "import-state.json") ||
			path === join(".harnessforce", "token.lock");
		const home = snapshotTree(t.home.home, isOwnState);
		const repo = snapshotTree(t.cwd);
		await t.run();
		expect(snapshotTree(t.home.home, isOwnState)).toEqual(home);
		expect(snapshotTree(t.cwd)).toEqual(repo);
	});

	it("rejects unknown options with the usage", async () => {
		const t = await setupTune();
		expect(await t.run(["--bogus"])).toEqual({
			code: 2,
			out: "",
			err: "使い方: harnessforce tune [--all] [--no-send] [--show-report] [--json] ｜ harnessforce tune record ｜ harnessforce tune --purge\n",
		});
		expect((await t.run(["record", "--all"])).code).toBe(2);
	});

	it("keeps each session's MCP servers from the first analysis", async () => {
		const t = await setupTune({ sessions: 1 });
		writeFile(
			join(t.cwd, ".mcp.json"),
			JSON.stringify({ mcpServers: { github: { command: "x" } } }),
		);
		writeFile(
			join(t.home.home, ".claude.json"),
			JSON.stringify({ mcpServers: { github: { command: "y" } } }),
		);
		const transcriptPath = join(
			t.home.home,
			".claude",
			"projects",
			"-work-web",
			"s000.jsonl",
		);
		const { tuneTranscript } = await import("./harness.js");
		const call = (id: string, name: string) => ({
			type: "assistant",
			timestamp: new Date(NOW - 2 * 86_400_000 + 30_000).toISOString(),
			message: {
				id: `c-${id}`,
				model: "claude-opus-5-5",
				usage: { input_tokens: 1, output_tokens: 1 },
				content: [{ type: "tool_use", id, name, input: {} }],
			},
		});
		writeFileSync(
			transcriptPath,
			tuneTranscript("s000", t.cwd, NOW - 2 * 86_400_000, [
				call("t1", "mcp__github__get_issue"),
				call("t2", "mcp__playwright__click"),
				call("t3", "mcp__playwright__close"),
			]),
		);
		const servers = async () => {
			const result = await t.run(["--json", "--no-send"]);
			return JSON.parse(result.out).sessions[0].report.mcp_servers;
		};
		const first = await servers();
		expect(first).toEqual([
			expect.objectContaining({ server: "github", configured: true, calls: 1 }),
			expect.objectContaining({
				server: "unlisted",
				configured: false,
				calls: 2,
			}),
		]);
		writeFile(
			join(t.cwd, ".mcp.json"),
			JSON.stringify({ mcpServers: { slack: { command: "z" } } }),
		);
		writeFile(join(t.home.home, ".claude.json"), "{}");
		expect(await servers()).toEqual(first);
		expect((await t.run(["--purge"])).code).toBe(0);
		expect(await servers()).toEqual([
			expect.objectContaining({ server: "slack", configured: true, calls: 0 }),
			expect.objectContaining({ server: "unlisted", calls: 3 }),
		]);
	});
});
