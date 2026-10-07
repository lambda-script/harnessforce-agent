import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { storedToken } from "@harnessforce/test-support/api-token";
import { describe, expect, it } from "vitest";
import { codeChallenge } from "../../src/init/pkce.js";
import { fakeKeychain, untouchableKeychain } from "../support/cli.js";
import {
	fakeBrowser,
	issued,
	makeHome,
	runInit,
	sha256,
	startCredentialsServer,
	TOKEN_EXPIRY,
} from "./harness.js";

// correlation.md「CLI」の`hf init`が定める文言。
const M = {
	success:
		"Harnessforceに接続しました。Claude Codeを再起動すると設定が反映されます",
	invalidUrl: "接続先のURLが不正です",
	keychain: "OSのキーチェーンを利用できないため、送信キーを保存できません",
	tooManyKeys:
		"keychainにある送信キーが多すぎるため、`hf init`を実行できません",
	tooManyCredentials:
		"keychainにある送信キーまたはログインの情報が多すぎるため、`hf init`を実行できません",
	settings: "Claude Codeのuser settingsを読めません",
	network:
		"Harnessforceとの通信に失敗しました。もう一度`hf init`を実行してください",
	listen: "ログインの待ち受けを開始できませんでした",
	timeout:
		"ログインが時間内に完了しませんでした。もう一度`hf init`を実行してください",
	denied: "ログインが拒否されました",
	noWorkspace:
		"参加しているWorkspaceがありません。Workspaceを作成するか招待を受諾してから、もう一度`hf init`を実行してください",
	loginFailed: "ログインに失敗しました。もう一度`hf init`を実行してください",
	viewer:
		"閲覧のみのロールでは送信キーを発行できません。Workspaceの管理者に連絡してください",
	limitAdmin:
		"有効な送信キーの数が上限に達しました。送信キーの画面で使っていないキーを失効してください",
	limitMember:
		"送信キーの上限に達しています。Workspaceの管理者に連絡してください",
	gate: "受信側へ反映できませんでした。変更はしていません。もう一度お試しください",
	noIngest: "この環境はテレメトリを受信しないため、送信キーを発行できません",
	saveFailed:
		"送信キーを保存できませんでした。もう一度`hf init`を実行してください",
	contentNotOptedIn:
		"このWorkspaceは本文データをopt-inしていないため、本文を送る設定は有効にしませんでした。Workspaceの設定のデータの保持でopt-inしてから、もう一度`hf init --send-content`を実行してください",
};

const failed = (message: string) => ({ code: 1, out: "", err: `${message}\n` });

// portを確保できなかったときの文言。使えなかったportと`--port`の逃げ道を示す（correlation.md「CLI」）。
const listenFailed = (port: number) =>
	`${M.listen}。port ${port}を使っているprocessを終えるか、\`hf init --port\`で別のportを指定してください`;

const EXISTING = {
	"ws1:ingest-key": "hf_ik_ws1_old",
	"ws1:api-token": storedToken("ws1", "old", TOKEN_EXPIRY),
	"ws2:ingest-key": "hf_ik_ws2_other",
	"ws2:api-token": storedToken("ws2", "other", TOKEN_EXPIRY),
};

// 応答の4つの値を、受け取ったままの文字列で保存する。
const issuedApiToken = {
	access_token: issued.access_token,
	access_token_expires_at: issued.access_token_expires_at,
	refresh_token: issued.refresh_token,
	refresh_token_expires_at: issued.refresh_token_expires_at,
};

describe("hf init", () => {
	it("logs in, issues credentials, stores them and writes user settings", async () => {
		const server = await startCredentialsServer();
		const browser = fakeBrowser();
		const { keychain, items } = fakeKeychain({ items: EXISTING });
		const home = makeHome(
			JSON.stringify({
				model: "opus",
				env: { EDITOR: "vim" },
				enabledPlugins: { "other@market": true },
			}),
		);
		const result = await runInit([], {
			homeDir: home.home,
			defaultUrl: server.base,
			keychain,
			openBrowser: browser.open,
		});
		expect(result).toEqual({ code: 0, out: `${M.success}\n`, err: "" });

		const [authorization] = browser.opened;
		expect(`${authorization?.origin}${authorization?.pathname}`).toBe(
			`${server.base}/oauth/authorize`,
		);
		const query = Object.fromEntries(authorization?.searchParams ?? []);
		expect(query).toEqual({
			response_type: "code",
			client_id: "harnessforce-cli",
			redirect_uri: expect.stringMatching(
				/^http:\/\/127\.0\.0\.1:\d+\/callback$/,
			),
			code_challenge: expect.any(String),
			code_challenge_method: "S256",
			state: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
		});
		expect(await browser.pages[0]).toContain("ターミナルに戻ってください");

		const [request] = server.credentialRequests;
		expect(request?.headers["content-type"]).toBe("application/json");
		const body = request?.body as Record<string, unknown>;
		expect(body).toEqual({
			code: "code-1",
			code_verifier: expect.any(String),
			client_id: "harnessforce-cli",
			redirect_uri: query.redirect_uri,
			revoke_key_hashes: expect.arrayContaining([
				sha256("hf_ik_ws1_old"),
				sha256("hf_ik_ws2_other"),
			]),
			// keychainのすべてのApiTokenのrefresh tokenのhash。
			revoke_api_token_hashes: expect.arrayContaining([
				sha256("hf_rt_ws1_old"),
				sha256("hf_rt_ws2_other"),
			]),
		});
		expect(body.revoke_key_hashes).toHaveLength(2);
		expect(body.revoke_api_token_hashes).toHaveLength(2);
		expect(codeChallenge(body.code_verifier as string)).toBe(
			query.code_challenge,
		);

		const { "ws1:api-token": apiToken, ...rest } = Object.fromEntries(items);
		expect(JSON.parse(apiToken ?? "")).toEqual(issuedApiToken);
		const { "ws1:api-token": _old, ...existingRest } = EXISTING;
		expect(rest).toEqual({
			...existingRest,
			"ws1:ingest-key": issued.ingest_key,
			// 送信先の固定。ingest_endpointのscheme、host、portだけを保存する。
			"ws1:ingest-origin": "https://ingest.example.test",
			"ws1:url-origin": `http://127.0.0.1:${new URL(server.base).port}`,
		});
		const settings = JSON.parse(home.read() ?? "");
		expect(settings).toEqual({
			model: "opus",
			env: {
				EDITOR: "vim",
				HARNESSFORCE_URL: server.base,
				HARNESSFORCE_ENDPOINT: issued.ingest_endpoint,
				OTEL_EXPORTER_OTLP_ENDPOINT: issued.ingest_endpoint,
				HARNESSFORCE_WORKSPACE_ID: "ws1",
				CLAUDE_CODE_ENABLE_TELEMETRY: "1",
				CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
				OTEL_METRICS_EXPORTER: "otlp",
				OTEL_LOGS_EXPORTER: "otlp",
				OTEL_TRACES_EXPORTER: "otlp",
				OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
			},
			otelHeadersHelper: "hf otel-headers",
			enabledPlugins: {
				"other@market": true,
				"harnessforce@harnessforce-agent": true,
			},
		});
		expect(home.read()).not.toContain(issued.ingest_key);
		expect(home.read()).not.toContain(issued.access_token);
		expect(home.read()).not.toContain(issued.refresh_token);
	});

	it("uses --url instead of the build default, including a path, and records it", async () => {
		const server = await startCredentialsServer({ basePath: "/hf" });
		const browser = fakeBrowser();
		const home = makeHome();
		const result = await runInit(["--url", server.base], {
			homeDir: home.home,
			defaultUrl: "https://default.example.test",
			openBrowser: browser.open,
		});
		expect(result.code).toBe(0);
		// RFC 8414 §3.1: well-knownはhostとpathの間に挿入する。
		expect(server.metadataRequests()).toEqual([
			"/.well-known/oauth-authorization-server/hf",
		]);
		expect(JSON.parse(home.read() ?? "").env.HARNESSFORCE_URL).toBe(
			server.base,
		);
	});

	it("records the connection URL without userinfo, query or fragment", async () => {
		const server = await startCredentialsServer({ basePath: "/hf" });
		const withUserinfo = server.base.replace("http://", "http://user:pass@");
		const home = makeHome();
		const { keychain, items } = fakeKeychain();
		const result = await runInit(["--url", `${withUserinfo}?x=1#y`], {
			homeDir: home.home,
			keychain,
			openBrowser: fakeBrowser().open,
		});
		expect(result.code).toBe(0);
		expect(items.get("ws1:url-origin")).toBe(
			`http://127.0.0.1:${new URL(server.base).port}`,
		);
		expect(JSON.parse(home.read() ?? "").env.HARNESSFORCE_URL).toBe(
			server.base,
		);
		expect(home.read()).not.toContain("pass");
	});

	it("re-pins both origins on a later hf init with another --url", async () => {
		const server = await startCredentialsServer({ basePath: "/hf" });
		const { keychain, items } = fakeKeychain({
			items: {
				"ws1:ingest-key": "hf_ik_ws1_old",
				"ws1:ingest-origin": "https://old-ingest.example.test",
				"ws1:url-origin": "https://old.example.test",
			},
		});
		await runInit(["--url", server.base], {
			homeDir: makeHome().home,
			defaultUrl: "https://default.example.test",
			keychain,
			openBrowser: fakeBrowser().open,
		});
		expect(Object.fromEntries(items)).toEqual({
			"ws1:ingest-key": "hf_ik_ws1_new",
			"ws1:api-token": expect.stringContaining(issued.refresh_token),
			"ws1:ingest-origin": "https://ingest.example.test",
			// pathの`/hf`を含めない。
			"ws1:url-origin": `http://127.0.0.1:${new URL(server.base).port}`,
		});
	});

	// 途中で失敗しても、前の接続先のoriginと新しいkeyの組を残さない。
	it("deletes both pinned origins before saving the new key and token", async () => {
		const server = await startCredentialsServer();
		const { keychain, writes } = fakeKeychain();
		await runInit([], {
			homeDir: makeHome().home,
			defaultUrl: server.base,
			keychain,
			openBrowser: fakeBrowser().open,
		});
		expect(writes).toEqual([
			"delete ws1:ingest-origin",
			"delete ws1:url-origin",
			"ws1:ingest-key",
			"ws1:api-token",
			"ws1:ingest-origin",
			"ws1:url-origin",
		]);
	});

	it("honors CLAUDE_CONFIG_DIR for the user settings file", async () => {
		const server = await startCredentialsServer();
		const home = makeHome();
		const configDir = makeHome().home;
		await runInit([], {
			env: { CLAUDE_CONFIG_DIR: configDir },
			homeDir: home.home,
			defaultUrl: server.base,
			openBrowser: fakeBrowser().open,
		});
		expect(home.read()).toBeUndefined();
		expect(
			JSON.parse(readFileSync(join(configDir, "settings.json"), "utf8"))
				.otelHeadersHelper,
		).toBe("hf otel-headers");
	});

	it("prints the authorization URL when the browser cannot be opened and keeps waiting", async () => {
		const server = await startCredentialsServer();
		const browser = fakeBrowser({ opens: false, favicon: true });
		const result = await runInit([], {
			homeDir: makeHome().home,
			defaultUrl: server.base,
			openBrowser: browser.open,
		});
		expect(result.code).toBe(0);
		expect(result.err).toBe(`${browser.opened[0]?.href}\n`);
	});

	describe("before login", () => {
		it.each([
			"http://app.example.test",
			"ftp://app.example.test",
			"not a url",
		])("rejects --url %s without touching anything", async (url) =>
			expect(
				await runInit(["--url", url], {
					homeDir: makeHome().home,
					keychain: untouchableKeychain,
				}),
			).toEqual(failed(M.invalidUrl)));

		it.each([
			[["--url"]],
			[["--bogus"]],
			[["--url", "https://a", "x"]],
			[["--port"]],
			[["--port", "0"]],
			[["--port", "65536"]],
			[["--port", "abc"]],
			[["--port", "1.5"]],
			[["--send-content", "true"]],
			[["--send-content", "--send-content"]],
		])("rejects the arguments %j with usage", async (argv) => {
			const result = await runInit(argv, { homeDir: makeHome().home });
			expect(result.code).toBe(1);
			expect(result.err).toContain("Usage: hf");
		});

		it.each([
			["the keychain is unavailable", { available: false }],
			["the keychain items cannot be read", { failRead: true }],
		])("stops when %s", async (_, options) => {
			const server = await startCredentialsServer();
			expect(
				await runInit([], {
					homeDir: makeHome().home,
					defaultUrl: server.base,
					keychain: fakeKeychain(options).keychain,
				}),
			).toEqual(failed(M.keychain));
			expect(server.metadataRequests()).toEqual([]);
		});

		it("stops when the keychain holds more than 100 ingest keys", async () => {
			const server = await startCredentialsServer();
			const items = Object.fromEntries(
				Array.from({ length: 101 }, (_, i) => [
					`ws${i}:ingest-key`,
					`hf_ik_ws${i}_k`,
				]),
			);
			expect(
				await runInit([], {
					homeDir: makeHome().home,
					defaultUrl: server.base,
					keychain: fakeKeychain({ items }).keychain,
				}),
			).toEqual(failed(M.tooManyKeys));
			expect(server.metadataRequests()).toEqual([]);
		});

		it("stops when the keychain holds more than 100 ApiTokens", async () => {
			const server = await startCredentialsServer();
			const items = Object.fromEntries(
				Array.from({ length: 101 }, (_, i) => [
					`ws${i}:api-token`,
					storedToken(`ws${i}`, "t", TOKEN_EXPIRY),
				]),
			);
			expect(
				await runInit([], {
					homeDir: makeHome().home,
					defaultUrl: server.base,
					keychain: fakeKeychain({ items }).keychain,
				}),
			).toEqual(failed(M.tooManyCredentials));
			expect(server.metadataRequests()).toEqual([]);
		});

		it("does not send a hash for an ApiToken item it cannot read", async () => {
			const server = await startCredentialsServer();
			const { keychain } = fakeKeychain({
				items: {
					"ws1:api-token": "hf_at_from_an_older_hf_init",
					"ws2:api-token": storedToken("ws2", "other", TOKEN_EXPIRY),
				},
			});
			const result = await runInit([], {
				homeDir: makeHome().home,
				defaultUrl: server.base,
				keychain,
				openBrowser: fakeBrowser().open,
			});
			expect(result.code).toBe(0);
			expect(server.credentialRequests[0]?.body).toMatchObject({
				revoke_api_token_hashes: [sha256("hf_rt_ws2_other")],
			});
		});

		it.each([
			"{",
			"[]",
			'{"env":[]}',
			'{"enabledPlugins":"x"}',
		])("stops when the user settings are %s", async (content) => {
			const server = await startCredentialsServer();
			const home = makeHome(content);
			expect(
				await runInit([], { homeDir: home.home, defaultUrl: server.base }),
			).toEqual(failed(M.settings));
			expect(server.metadataRequests()).toEqual([]);
			expect(home.read()).toBe(content);
		});
	});

	describe("authorization server metadata", () => {
		it.each([
			["a 500", () => ({ status: 500 })],
			[
				"a redirect",
				(base: string) => ({
					status: 302,
					headers: { location: `${base}/elsewhere` },
				}),
			],
			["a non-object body", () => ({ status: 200, body: [] })],
			[
				"a different issuer",
				(base: string) => ({
					status: 200,
					body: {
						issuer: "https://evil.example.test",
						authorization_endpoint: `${base}/oauth/authorize`,
					},
				}),
			],
			[
				"a plain-http remote authorization endpoint",
				(base: string) => ({
					status: 200,
					body: {
						issuer: base,
						authorization_endpoint: "http://auth.example.test/authorize",
					},
				}),
			],
			[
				"no authorization endpoint",
				(base: string) => ({ status: 200, body: { issuer: `${base}/` } }),
			],
		])("fails on %s without opening the browser", async (_, metadata) => {
			const server = await startCredentialsServer({ metadata });
			const browser = fakeBrowser();
			expect(
				await runInit([], {
					homeDir: makeHome().home,
					defaultUrl: server.base,
					openBrowser: browser.open,
				}),
			).toEqual(failed(M.network));
			expect(browser.opened).toEqual([]);
		});

		it("accepts an issuer that differs only by a trailing slash", async () => {
			const server = await startCredentialsServer({
				metadata: (base) => ({
					status: 200,
					body: {
						issuer: `${base}/`,
						authorization_endpoint: `${base}/oauth/authorize`,
					},
				}),
			});
			const result = await runInit([], {
				homeDir: makeHome().home,
				defaultUrl: server.base,
				openBrowser: fakeBrowser().open,
			});
			expect(result.code).toBe(0);
		});
	});

	describe("callback", () => {
		it.each([
			[
				"a wrong state even with access_denied",
				{ error: "access_denied", state: "forged" },
				M.loginFailed,
			],
			[
				"a missing state with no_workspace",
				{ error: "no_workspace", state: undefined },
				M.loginFailed,
			],
			["access_denied", { error: "access_denied" }, M.denied],
			["no_workspace", { error: "no_workspace" }, M.noWorkspace],
			["another error", { error: "server_error" }, M.loginFailed],
			["no code", {}, M.loginFailed],
		])("ends on %s without sending the code", async (_, params, message) => {
			const server = await startCredentialsServer();
			const browser = fakeBrowser({
				query: (authorization) => ({
					state: authorization.searchParams.get("state") ?? "",
					...params,
				}),
			});
			const { keychain, items } = fakeKeychain({ items: EXISTING });
			const home = makeHome();
			expect(
				await runInit([], {
					homeDir: home.home,
					defaultUrl: server.base,
					keychain,
					openBrowser: browser.open,
				}),
			).toEqual(failed(message));
			expect(server.credentialRequests).toEqual([]);
			expect(Object.fromEntries(items)).toEqual(EXISTING);
			expect(home.read()).toBeUndefined();
		});

		it("times out when no callback arrives", async () => {
			const server = await startCredentialsServer();
			expect(
				await runInit([], {
					homeDir: makeHome().home,
					defaultUrl: server.base,
					openBrowser: fakeBrowser({ callback: false }).open,
					callbackTimeoutMs: 50,
				}),
			).toEqual(failed(M.timeout));
		});

		it("ends when the loopback cannot listen, naming port 8080", async () => {
			const server = await startCredentialsServer();
			const browser = fakeBrowser();
			let askedPort: number | undefined;
			expect(
				await runInit([], {
					homeDir: makeHome().home,
					defaultUrl: server.base,
					openBrowser: browser.open,
					startLoopback: async (options) => {
						askedPort = options.port;
						throw new Error("EADDRINUSE");
					},
				}),
			).toEqual(failed(listenFailed(8080)));
			// 既定は8080で、portを確保できないときは他のportへ落ちない。
			expect(askedPort).toBe(8080);
			expect(browser.opened).toEqual([]);
		});

		it("starts the loopback on the --port value and names it on failure", async () => {
			const server = await startCredentialsServer();
			let askedPort: number | undefined;
			expect(
				await runInit(["--port", "1234"], {
					homeDir: makeHome().home,
					defaultUrl: server.base,
					openBrowser: fakeBrowser().open,
					startLoopback: async (options) => {
						askedPort = options.port;
						throw new Error("EADDRINUSE");
					},
				}),
			).toEqual(failed(listenFailed(1234)));
			expect(askedPort).toBe(1234);
		});

		it("reads --port after --url", async () => {
			const server = await startCredentialsServer();
			let askedPort: number | undefined;
			expect(
				await runInit(["--url", server.base, "--port", "1234"], {
					homeDir: makeHome().home,
					defaultUrl: "https://default.example.test",
					openBrowser: fakeBrowser().open,
					startLoopback: async (options) => {
						askedPort = options.port;
						throw new Error("EADDRINUSE");
					},
				}),
			).toEqual(failed(listenFailed(1234)));
			expect(askedPort).toBe(1234);
			// --portの後ろでも--urlが読まれている（metadata要求がdefaultUrlではなくserverへ届く）。
			expect(server.metadataRequests()).toHaveLength(1);
		});
	});

	describe("credentials response", () => {
		it.each([
			[400, { code: "invalid_grant" }, M.loginFailed],
			[403, { code: "viewer_cannot_issue_ingest_key" }, M.viewer],
			[409, { code: "ingest_key_limit", role: "owner" }, M.limitAdmin],
			[409, { code: "ingest_key_limit", role: "admin" }, M.limitAdmin],
			[409, { code: "ingest_key_limit", role: "member" }, M.limitMember],
			[409, { code: "ingest_key_limit", role: "viewer" }, M.network],
			[409, { code: "conflict" }, M.network],
			[503, { code: "gate_unavailable" }, M.gate],
			[503, { code: "ingest_unavailable" }, M.noIngest],
			[503, { code: "maintenance" }, M.network],
			[400, { code: "invalid_request" }, M.network],
			[403, { code: "forbidden" }, M.network],
			[401, undefined, M.network],
			[500, undefined, M.network],
			[201, { ...issued, ingest_key: "hf_ik_ws2_new" }, M.network],
			[
				201,
				{ ...issued, workspace_id: "ws_1", ingest_key: "hf_ik_ws_1_k" },
				M.network,
			],
			[201, { ...issued, access_token: "hf_at_ws1_has space" }, M.network],
			[201, { ...issued, access_token: "hf_at_ws2_other" }, M.network],
			[201, { ...issued, refresh_token: "hf_at_ws1_new" }, M.network],
			[
				201,
				{ ...issued, access_token_expires_at: "2026-09-28T01:00:00" },
				M.network,
			],
			[
				201,
				{ ...issued, refresh_token_expires_at: "not an instant" },
				M.network,
			],
			[201, { ...issued, refresh_token_expires_at: undefined }, M.network],
			[
				201,
				{ ...issued, ingest_endpoint: "http://ingest.example.test" },
				M.network,
			],
			[201, { ...issued, content_opt_in: "true" }, M.network],
			[201, { ...issued, content_opt_in: undefined }, M.network],
			[201, "not an object", M.network],
		])("maps %i %j to its terminal and changes nothing", async (status, body, message) => {
			const server = await startCredentialsServer({
				credentials: { status, body },
			});
			const { keychain, items } = fakeKeychain({ items: EXISTING });
			const home = makeHome('{"model":"opus"}');
			expect(
				await runInit([], {
					homeDir: home.home,
					defaultUrl: server.base,
					keychain,
					openBrowser: fakeBrowser().open,
				}),
			).toEqual(failed(message));
			expect(Object.fromEntries(items)).toEqual(EXISTING);
			expect(home.read()).toBe('{"model":"opus"}');
		});

		it("fails when Harnessforce cannot be reached for the credentials", async () => {
			const server = await startCredentialsServer();
			const result = await runInit([], {
				homeDir: makeHome().home,
				defaultUrl: server.base,
				openBrowser: fakeBrowser().open,
				fetch: async (input, init) => {
					if (init?.method === "POST") throw new TypeError("fetch failed");
					return fetch(input, init);
				},
			});
			expect(result).toEqual(failed(M.network));
		});
	});

	describe("--send-content", () => {
		it("adds OTEL_LOG_USER_PROMPTS when the workspace has opted in to content", async () => {
			const server = await startCredentialsServer({
				credentials: {
					status: 201,
					body: { ...issued, content_opt_in: true },
				},
			});
			const home = makeHome();
			const result = await runInit(["--send-content"], {
				homeDir: home.home,
				defaultUrl: server.base,
				openBrowser: fakeBrowser().open,
			});
			expect(result).toEqual({ code: 0, out: `${M.success}\n`, err: "" });
			expect(JSON.parse(home.read() ?? "").env.OTEL_LOG_USER_PROMPTS).toBe("1");
		});

		// opt-inしていないWorkspaceでは書き込まず、理由とopt-inの場所を示す。発行と保存は済んでいるため失敗としない。
		it("keeps the setting as it was and explains why when the workspace has not opted in", async () => {
			const server = await startCredentialsServer();
			// 既存の値が`1`でも書き換えないことを確かめる（`0`を種にすると、書き込んだ`0`と見分けられない）。
			const home = makeHome('{"env":{"OTEL_LOG_USER_PROMPTS":"1"}}');
			const result = await runInit(["--send-content"], {
				homeDir: home.home,
				defaultUrl: server.base,
				openBrowser: fakeBrowser().open,
			});
			expect(result).toEqual({
				code: 0,
				out: `${M.contentNotOptedIn}\n${M.success}\n`,
				err: "",
			});
			const env = JSON.parse(home.read() ?? "").env;
			expect(env.HARNESSFORCE_WORKSPACE_ID).toBe("ws1");
			expect(env.OTEL_LOG_USER_PROMPTS).toBe("1");
		});

		// キーを持つhomeを種にすると書き込んだ`1`と元の`1`を見分けられないため、キーの無いhomeでも確かめる。
		it("adds no setting when the workspace has not opted in and the setting is absent", async () => {
			const server = await startCredentialsServer();
			const home = makeHome();
			const result = await runInit(["--send-content"], {
				homeDir: home.home,
				defaultUrl: server.base,
				openBrowser: fakeBrowser().open,
			});
			expect(result).toEqual({
				code: 0,
				out: `${M.contentNotOptedIn}\n${M.success}\n`,
				err: "",
			});
			const env = JSON.parse(home.read() ?? "").env;
			expect(env).not.toHaveProperty("OTEL_LOG_USER_PROMPTS");
		});

		it("leaves OTEL_LOG_USER_PROMPTS alone without the flag", async () => {
			const server = await startCredentialsServer({
				credentials: {
					status: 201,
					body: { ...issued, content_opt_in: true },
				},
			});
			const home = makeHome('{"env":{"OTEL_LOG_USER_PROMPTS":"0"}}');
			const result = await runInit([], {
				homeDir: home.home,
				defaultUrl: server.base,
				openBrowser: fakeBrowser().open,
			});
			expect(result).toEqual({ code: 0, out: `${M.success}\n`, err: "" });
			expect(JSON.parse(home.read() ?? "").env.OTEL_LOG_USER_PROMPTS).toBe("0");
		});
	});

	describe("saving", () => {
		it("fails when the keychain cannot be written, leaving settings alone", async () => {
			const server = await startCredentialsServer();
			const home = makeHome();
			expect(
				await runInit([], {
					homeDir: home.home,
					defaultUrl: server.base,
					keychain: fakeKeychain({ failWrite: true }).keychain,
					openBrowser: fakeBrowser().open,
				}),
			).toEqual(failed(M.saveFailed));
			expect(home.read()).toBeUndefined();
		});

		// 途中で失敗しても、前の接続先のoriginと新しいkeyやtokenの組を残さない。
		it("leaves no pinned origin when saving fails after the key", async () => {
			const server = await startCredentialsServer();
			const { keychain, items } = fakeKeychain({
				items: {
					"ws1:ingest-key": "hf_ik_ws1_old",
					"ws1:api-token": storedToken("ws1", "old", TOKEN_EXPIRY),
					"ws1:ingest-origin": "https://old-ingest.example.test",
					"ws1:url-origin": "https://old.example.test",
				},
				failWriteOn: "ws1:api-token",
			});
			expect(
				await runInit([], {
					homeDir: makeHome().home,
					defaultUrl: server.base,
					keychain,
					openBrowser: fakeBrowser().open,
				}),
			).toEqual(failed(M.saveFailed));
			expect(items.get("ws1:ingest-key")).toBe("hf_ik_ws1_new");
			expect(items.has("ws1:ingest-origin")).toBe(false);
			expect(items.has("ws1:url-origin")).toBe(false);
		});

		it("fails when the user settings became unreadable during login", async () => {
			const server = await startCredentialsServer();
			const home = makeHome("{}");
			const { keychain, items } = fakeKeychain();
			const browser = fakeBrowser({
				beforeCallback: () => writeFileSync(home.path, "{"),
			});
			expect(
				await runInit([], {
					homeDir: home.home,
					defaultUrl: server.base,
					keychain,
					openBrowser: browser.open,
				}),
			).toEqual(failed(M.saveFailed));
			expect(home.read()).toBe("{");
			// 手順6の失敗では、新しいkeyはkeychainに保存されている。
			expect(items.get("ws1:ingest-key")).toBe(issued.ingest_key);
		});
	});
});
