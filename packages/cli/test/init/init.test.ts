import {
	chmodSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parse } from "@decimalturn/toml-patch";
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

// correlation.md「CLI」の`harnessforce init`が定める文言。
const M = {
	success:
		"Connected to Harnessforce. Restart Claude Code to apply the settings",
	invalidUrl: "The connection URL is invalid",
	keychain: "The OS keychain is unavailable, so the ingest key cannot be saved",
	kernelKeyring:
		"The Secret Service is unavailable, so the ingest key was saved in the kernel keyring. It is lost on reboot or after a period of disuse. If it disappears, run `harnessforce init` again",
	waiting: "Waiting for the Secret Service unlock prompt (up to 60 seconds)",
	tooManyKeys:
		"There are too many ingest keys in the keychain, so `harnessforce init` cannot run",
	tooManyCredentials:
		"There are too many ingest keys or login entries in the keychain, so `harnessforce init` cannot run",
	settings: "Cannot read the Claude Code user settings",
	network:
		"Communication with Harnessforce failed. Run `harnessforce init` again",
	listen: "Could not start waiting for the login",
	timeout: "The login did not complete in time. Run `harnessforce init` again",
	denied: "The login was denied",
	noWorkspace:
		"You are not a member of any Workspace. Create a Workspace or accept an invitation, then run `harnessforce init` again",
	loginFailed: "The login failed. Run `harnessforce init` again",
	viewer:
		"The view-only role cannot issue an ingest key. Contact a Workspace administrator",
	limitAdmin:
		"The number of active ingest keys has reached the limit. Ask members to revoke unused keys in My ingest keys on their account page",
	limitMember:
		"The ingest key limit has been reached. Contact a Workspace administrator",
	gate: "Could not apply the change on the receiving side. Nothing was changed. Try again",
	noIngest:
		"This environment does not receive telemetry, so an ingest key cannot be issued",
	saveFailed: "Could not save the ingest key. Run `harnessforce init` again",
	pluginAutoUpdateOn:
		"Automatic updates for the Harnessforce plugin are on. To turn them off, run `harnessforce init --no-plugin-auto-update` or use /plugin",
	contentNotStored:
		"This workspace does not store content, so sending content was not enabled. An owner or admin can turn it on under Collection & retention in the workspace settings, then run `harnessforce init --send-content` again",
	contentNotSent:
		"Content is not sent from this machine. Run `harnessforce init --send-content` to send it",
};

// Codexの`config.toml`を書いた後の案内（correlation.md「CLI」の手順8）。
const codexNotes = (home: string) =>
	[
		`Wrote the Codex configuration (${join(home, ".codex", "config.toml")}). Restart Codex to apply it`,
		"Codex hooks do not run until you trust them in Codex's /hooks. Trust the harnessforce SessionStart, PostToolUse, and Stop hooks in /hooks",
		"To use the Harnessforce MCP server, log in with `codex mcp login harnessforce`",
	].join("\n");
// client-updates.md「Claude Codeのplugin」: pluginの自動更新を有効にした旨を、完了の表示に続けて示す。
const afterContentNotice = (home: string) =>
	`${M.success}\n${M.pluginAutoUpdateOn}\n${codexNotes(home)}\n`;
// 本文の案内（手順6）は、完了の表示（手順8）より前に出る。`--send-content`の無い実行は送らない旨を示す。
const finished = (home: string) =>
	`${M.contentNotSent}\n${afterContentNotice(home)}`;

const contentEnabled = (categories: string, readers: string, days = 30) =>
	`Sending ${categories} is now enabled. Values that match known patterns for secrets and personal information are masked, but not everything can be detected. ${readers}. It is deleted after ${days} days`;

const content = (
	overrides: Partial<{
		prompts: boolean;
		model_and_tools: boolean;
		visibility: string;
		retention_days: number;
	}> = {},
) => ({ ...issued.content, ...overrides });

const NO_CONTENT_ENV = {
	OTEL_LOG_USER_PROMPTS: "0",
	OTEL_LOG_ASSISTANT_RESPONSES: "0",
	OTEL_LOG_TOOL_DETAILS: "0",
	OTEL_LOG_TOOL_CONTENT: "0",
};

const codexSaveFailed =
	"Could not write the Codex configuration. Run `harnessforce init` again";

const failed = (message: string) => ({ code: 1, out: "", err: `${message}\n` });

// portを確保できなかったときの文言。使えなかったportと`--port`の逃げ道を示す（correlation.md「CLI」）。
const listenFailed = (port: number) =>
	`${M.listen}. Stop the process using port ${port}, or specify another port with \`harnessforce init --port\``;

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

describe("harnessforce init", () => {
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
		expect(result).toEqual({ code: 0, out: finished(home.home), err: "" });

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
		// 結果が決まってから、webの完了画面へ移す。code、stateは載せない。
		expect(await browser.pages[0]).toMatchObject({
			status: 303,
			location: `${server.base}/cli/connected?status=connected&workspace=${issued.workspace_id}`,
			cacheControl: "no-store",
			body: "",
		});

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
				...NO_CONTENT_ENV,
				CLAUDE_CODE_ENABLE_TELEMETRY: "1",
				CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
				OTEL_METRICS_INCLUDE_ENTRYPOINT: "true",
				OTEL_METRICS_EXPORTER: "otlp",
				OTEL_LOGS_EXPORTER: "otlp",
				OTEL_TRACES_EXPORTER: "otlp",
				OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
			},
			otelHeadersHelper: "harnessforce otel-headers",
			enabledPlugins: {
				"other@market": true,
				"harnessforce@harnessforce-agent": true,
			},
			extraKnownMarketplaces: {
				"harnessforce-agent": {
					source: {
						source: "github",
						repo: "lambda-script/harnessforce-agent",
					},
					autoUpdate: true,
				},
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

	it("tells the user when the connection is not the build default", async () => {
		const server = await startCredentialsServer();
		const result = await runInit(["--url", server.base], {
			homeDir: makeHome().home,
			defaultUrl: "https://default.example.test",
			openBrowser: fakeBrowser().open,
		});
		expect(result.code).toBe(0);
		expect(result.out).toContain(
			`Connecting to ${server.base} (not the default production endpoint)\n${M.success}\n`,
		);
	});

	it("adds nothing to the output when the connection is the build default", async () => {
		const server = await startCredentialsServer();
		const result = await runInit([], {
			homeDir: makeHome().home,
			defaultUrl: server.base,
			openBrowser: fakeBrowser().open,
		});
		expect(result.out).not.toContain("接続先");
		expect(result.out).toContain(`${M.success}\n`);
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

	it("re-pins both origins on a later harnessforce init with another --url", async () => {
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
			// 手順5: もう一方の保存先にある同じWorkspaceの項目を消す。
			"delete elsewhere ws1",
		]);
	});

	it("reads the previous workspace from the user settings when opening the keychain", async () => {
		const server = await startCredentialsServer();
		const { keychain, initOpens } = fakeKeychain();
		await runInit([], {
			homeDir: makeHome(
				JSON.stringify({ env: { HARNESSFORCE_WORKSPACE_ID: "ws0" } }),
			).home,
			defaultUrl: server.base,
			keychain,
			openBrowser: fakeBrowser().open,
		});
		expect(initOpens).toEqual(["ws0"]);
	});

	it("tells the user when the key is saved to the kernel keyring", async () => {
		const server = await startCredentialsServer();
		const home = makeHome();
		const result = await runInit([], {
			homeDir: home.home,
			defaultUrl: server.base,
			keychain: fakeKeychain({ kernelKeyring: true }).keychain,
			openBrowser: fakeBrowser().open,
		});
		expect(result).toEqual({
			code: 0,
			out: `${M.contentNotSent}\n${M.success}\n${M.kernelKeyring}\n${M.pluginAutoUpdateOn}\n${codexNotes(home.home)}\n`,
			err: "",
		});
	});

	it("tells the user it is waiting for the Secret Service to be unlocked", async () => {
		const server = await startCredentialsServer();
		const { keychain } = fakeKeychain();
		const open = keychain.openForInit;
		keychain.openForInit = (options) => {
			options.onWaiting({ isKWallet: false, walletLabel: "Login" });
			return open(options);
		};
		const result = await runInit([], {
			homeDir: makeHome().home,
			defaultUrl: server.base,
			keychain,
			openBrowser: fakeBrowser().open,
		});
		expect(result.code).toBe(0);
		expect(result.err).toBe(`${M.waiting}\n`);
	});

	it("tells the user where KWallet asks for the password while waiting", async () => {
		const server = await startCredentialsServer();
		const { keychain } = fakeKeychain();
		const open = keychain.openForInit;
		keychain.openForInit = (options) => {
			options.onWaiting({ isKWallet: true, walletLabel: "kdewallet" });
			return open(options);
		};
		const result = await runInit([], {
			homeDir: makeHome().home,
			defaultUrl: server.base,
			keychain,
			openBrowser: fakeBrowser().open,
		});
		expect(result.code).toBe(0);
		expect(result.err).toBe(
			`${M.waiting}\nKWallet asks for the password of the wallet "kdewallet" in a "KDE Wallet Service" window. If no window appears, an earlier request may be waiting behind other windows: answer that window, or log out and back in, then run \`harnessforce init\` again\n`,
		);
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
		).toBe("harnessforce otel-headers");
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
		it.each(["http://app.example.test", "ftp://app.example.test", "not a url"])(
			"rejects --url %s without touching anything",
			async (url) =>
				expect(
					await runInit(["--url", url], {
						homeDir: makeHome().home,
						keychain: untouchableKeychain,
					}),
				).toEqual(failed(M.invalidUrl)),
		);

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
			expect(result.err).toContain("Usage: harnessforce");
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

		it("adds the Linux guidance only when neither store can be used", async () => {
			const server = await startCredentialsServer();
			const hint = "linux hint";
			expect(
				await runInit([], {
					homeDir: makeHome().home,
					defaultUrl: server.base,
					keychain: fakeKeychain({ available: false, unavailableHint: hint })
						.keychain,
				}),
			).toEqual(failed(`${M.keychain}. ${hint}`));
			expect(
				await runInit([], {
					homeDir: makeHome().home,
					defaultUrl: server.base,
					keychain: fakeKeychain({ failRead: true, unavailableHint: hint })
						.keychain,
				}),
			).toEqual(failed(M.keychain));
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
			'{"extraKnownMarketplaces":"x"}',
			'{"additionalMarketplaces":{"harnessforce-agent":true}}',
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
			["access_denied", { error: "access_denied" }, M.denied, "denied"],
			[
				"no_workspace",
				{ error: "no_workspace" },
				M.noWorkspace,
				"no_workspace",
			],
			["another error", { error: "server_error" }, M.loginFailed, "failed"],
			["no code", {}, M.loginFailed, "failed"],
		])(
			"ends on %s without sending the code",
			async (_, params, message, status) => {
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
				expect(await browser.pages[0]).toMatchObject({
					status: 303,
					location: `${server.base}/cli/connected?status=${status}`,
				});
				expect(server.credentialRequests).toEqual([]);
				expect(Object.fromEntries(items)).toEqual(EXISTING);
				expect(home.read()).toBeUndefined();
			},
		);

		// 期待したstateを持たないcallbackは他のprocessやWebページからでも送れるため、ログインを終わらせない。
		it("ignores callbacks with a wrong or missing state and logs in with the real one", async () => {
			const server = await startCredentialsServer();
			const browser = fakeBrowser();
			const forged: { status: number; location: string | null }[] = [];
			const openBrowser = async (url: string) => {
				const redirectUri = new URL(url).searchParams.get("redirect_uri") ?? "";
				for (const query of [
					"error=access_denied&state=forged",
					"error=no_workspace",
				]) {
					const response = await fetch(`${redirectUri}?${query}`, {
						redirect: "manual",
					});
					forged.push({
						status: response.status,
						location: response.headers.get("location"),
					});
				}
				return browser.open(url);
			};
			const home = makeHome();
			expect(
				await runInit([], {
					homeDir: home.home,
					defaultUrl: server.base,
					openBrowser,
				}),
			).toEqual({ code: 0, out: finished(home.home), err: "" });
			expect(forged).toEqual([
				{ status: 303, location: `${server.base}/cli/connected?status=failed` },
				{ status: 303, location: `${server.base}/cli/connected?status=failed` },
			]);
			expect(server.credentialRequests).toEqual([
				expect.objectContaining({
					body: expect.objectContaining({ code: "code-1" }),
				}),
			]);
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
			[201, { ...issued, content: undefined }, M.network],
			[
				201,
				{ ...issued, content: content({ prompts: "true" as never }) },
				M.network,
			],
			[
				201,
				{ ...issued, content: content({ model_and_tools: undefined }) },
				M.network,
			],
			[
				201,
				{ ...issued, content: content({ visibility: "everyone" }) },
				M.network,
			],
			[201, { ...issued, content: content({ retention_days: 60 }) }, M.network],
			[201, "not an object", M.network],
		])(
			"maps %i %j to its terminal and changes nothing",
			async (status, body, message) => {
				const server = await startCredentialsServer({
					credentials: { status, body },
				});
				const { keychain, items } = fakeKeychain({ items: EXISTING });
				const home = makeHome('{"model":"opus"}');
				const browser = fakeBrowser();
				expect(
					await runInit([], {
						homeDir: home.home,
						defaultUrl: server.base,
						keychain,
						openBrowser: browser.open,
					}),
				).toEqual(failed(message));
				// 発行できなかった結果は、viewerだけを区別し、それ以外は失敗の画面へ移す。
				expect((await browser.pages[0])?.location).toBe(
					`${server.base}/cli/connected?status=${message === M.viewer ? "viewer" : "failed"}`,
				);
				expect(Object.fromEntries(items)).toEqual(EXISTING);
				expect(home.read()).toBe('{"model":"opus"}');
			},
		);

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
		const send = async (
			argv: string[],
			overrides: Parameters<typeof content>[0],
			seed?: string,
		) => {
			const server = await startCredentialsServer({
				credentials: {
					status: 201,
					body: { ...issued, content: content(overrides) },
				},
			});
			const home = makeHome(seed);
			const result = await runInit(argv, {
				homeDir: home.home,
				defaultUrl: server.base,
				openBrowser: fakeBrowser().open,
			});
			return { result, home, env: JSON.parse(home.read() ?? "").env };
		};

		it("turns all four variables on for a workspace that stores both categories", async () => {
			const { result, home, env } = await send(["--send-content"], {
				prompts: true,
				model_and_tools: true,
			});
			expect(result).toEqual({
				code: 0,
				out: `${contentEnabled("the prompts you type, model responses and tool input and output", "Everyone in the workspace can read it")}\n${afterContentNotice(home.home)}`,
				err: "",
			});
			expect(env).toMatchObject({
				OTEL_LOG_USER_PROMPTS: "1",
				OTEL_LOG_ASSISTANT_RESPONSES: "1",
				OTEL_LOG_TOOL_DETAILS: "1",
				OTEL_LOG_TOOL_CONTENT: "1",
			});
			expect(env).not.toHaveProperty("OTEL_LOG_RAW_API_BODIES");
		});

		it("turns only the prompt on for a workspace that stores prompts only", async () => {
			const { result, home, env } = await send(["--send-content"], {
				prompts: true,
				visibility: "sender_only",
				retention_days: 7,
			});
			expect(result.out).toBe(
				`${contentEnabled("the prompts you type", "Within the workspace, only you can read it", 7)}\n${afterContentNotice(home.home)}`,
			);
			expect(env).toMatchObject({
				...NO_CONTENT_ENV,
				OTEL_LOG_USER_PROMPTS: "1",
			});
		});

		it("names owners and admins as readers when the visibility says so", async () => {
			const { result } = await send(["--send-content"], {
				model_and_tools: true,
				visibility: "owners_admins_and_sender",
			});
			expect(result.out).toContain(
				"model responses and tool input and output is now enabled.",
			);
			expect(result.out).toContain("Owners, admins and you can read it. ");
		});

		// 発行と保存は済んでいるため失敗としない。既存の値が`1`でも`0`で書き直す。
		it("writes 0 and explains why when the workspace stores no content", async () => {
			const { result, home, env } = await send(
				["--send-content"],
				{},
				'{"env":{"OTEL_LOG_USER_PROMPTS":"1"}}',
			);
			expect(result).toEqual({
				code: 0,
				out: `${M.contentNotStored}\n${afterContentNotice(home.home)}`,
				err: "",
			});
			expect(env).toMatchObject(NO_CONTENT_ENV);
		});

		it("writes 0 for every variable without the flag, whatever the workspace stores", async () => {
			const { result, home, env } = await send(
				[],
				{ prompts: true, model_and_tools: true },
				'{"env":{"OTEL_LOG_USER_PROMPTS":"1"}}',
			);
			expect(result).toEqual({
				code: 0,
				out: `${M.contentNotSent}\n${afterContentNotice(home.home)}`,
				err: "",
			});
			expect(env).toMatchObject(NO_CONTENT_ENV);
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

	describe("Codex config.toml", () => {
		const codexPath = (home: string) => join(home, ".codex", "config.toml");

		it("writes the exporter, the SessionStart hook and the MCP server with the new key", async () => {
			const server = await startCredentialsServer();
			const home = makeHome();
			await runInit([], {
				homeDir: home.home,
				defaultUrl: server.base,
				openBrowser: fakeBrowser().open,
			});
			const config = parse(readFileSync(codexPath(home.home), "utf8"));
			expect(config).toEqual({
				otel: {
					exporter: {
						"otlp-http": {
							endpoint: issued.ingest_endpoint,
							headers: { Authorization: `Bearer ${issued.ingest_key}` },
							protocol: "binary",
						},
					},
					log_user_prompt: false,
					log_agent_responses: false,
				},
				hooks: {
					SessionStart: [
						{
							hooks: [
								{
									type: "command",
									command: "harnessforce hook session-start",
									commandWindows: "harnessforce.cmd hook session-start",
									timeout: 10,
								},
							],
						},
					],
					PostToolUse: [
						{
							matcher: "^apply_patch$",
							hooks: [
								{
									type: "command",
									command: "harnessforce hook post-tool-use",
									commandWindows: "harnessforce.cmd hook post-tool-use",
									timeout: 10,
									async: true,
								},
							],
						},
					],
					Stop: [
						{
							hooks: [
								{
									type: "command",
									command: "harnessforce hook stop",
									commandWindows: "harnessforce.cmd hook stop",
									timeout: 10,
									async: true,
								},
							],
						},
					],
				},
				mcp_servers: { harnessforce: { url: `${server.base}/mcp` } },
			});
			if (process.platform !== "win32")
				expect(statSync(codexPath(home.home)).mode & 0o777).toBe(0o600);
		});

		it("keeps the other settings and does not add the ApiToken", async () => {
			const server = await startCredentialsServer();
			const home = makeHome();
			mkdirSync(join(home.home, ".codex"));
			writeFileSync(
				codexPath(home.home),
				'model = "gpt-5" # mine\n\n[otel]\nenvironment = "prod"\n',
				{ mode: 0o644 },
			);
			await runInit([], {
				homeDir: home.home,
				defaultUrl: server.base,
				openBrowser: fakeBrowser().open,
			});
			const text = readFileSync(codexPath(home.home), "utf8");
			expect(text).toContain('model = "gpt-5" # mine');
			expect(text).toContain('environment = "prod"');
			expect(text).not.toContain(issued.access_token);
			expect(text).not.toContain(issued.refresh_token);
			if (process.platform !== "win32")
				expect(statSync(codexPath(home.home)).mode & 0o777).toBe(0o600);
		});

		it("uses CODEX_HOME when it is an absolute path", async () => {
			const server = await startCredentialsServer();
			const home = makeHome();
			const codexHome = join(home.home, "elsewhere");
			await runInit([], {
				homeDir: home.home,
				env: { CODEX_HOME: codexHome },
				defaultUrl: server.base,
				openBrowser: fakeBrowser().open,
			});
			expect(readFileSync(join(codexHome, "config.toml"), "utf8")).toContain(
				"harnessforce hook session-start",
			);
		});

		it("replaces only its own items when run again", async () => {
			const server = await startCredentialsServer();
			const home = makeHome();
			const run = () =>
				runInit([], {
					homeDir: home.home,
					defaultUrl: server.base,
					openBrowser: fakeBrowser().open,
				});
			await run();
			const first = readFileSync(codexPath(home.home), "utf8");
			await run();
			expect(readFileSync(codexPath(home.home), "utf8")).toBe(first);
		});

		it("writes log_user_prompt and log_agent_responses per category, true only with --send-content", async () => {
			const read = async (
				argv: string[],
				overrides: Parameters<typeof content>[0],
			) => {
				const server = await startCredentialsServer({
					credentials: {
						status: 201,
						body: { ...issued, content: content(overrides) },
					},
				});
				const home = makeHome();
				await runInit(argv, {
					homeDir: home.home,
					defaultUrl: server.base,
					openBrowser: fakeBrowser().open,
				});
				return (
					parse(readFileSync(codexPath(home.home), "utf8")) as {
						otel: Record<string, unknown>;
					}
				).otel;
			};
			const both = { prompts: true, model_and_tools: true };
			expect(await read(["--send-content"], both)).toMatchObject({
				log_user_prompt: true,
				log_agent_responses: true,
			});
			expect(await read(["--send-content"], { prompts: true })).toMatchObject({
				log_user_prompt: true,
				log_agent_responses: false,
			});
			expect(await read([], both)).toMatchObject({
				log_user_prompt: false,
				log_agent_responses: false,
			});
			expect(await read(["--send-content"], {})).toMatchObject({
				log_user_prompt: false,
				log_agent_responses: false,
			});
		});

		it("fails with the Codex message and leaves config.toml alone when it cannot be updated", async () => {
			const server = await startCredentialsServer();
			const home = makeHome();
			mkdirSync(join(home.home, ".codex"));
			writeFileSync(codexPath(home.home), "[otel");
			const { keychain, items } = fakeKeychain();
			expect(
				await runInit([], {
					homeDir: home.home,
					defaultUrl: server.base,
					keychain,
					openBrowser: fakeBrowser().open,
				}),
			).toEqual(failed(codexSaveFailed));
			expect(readFileSync(codexPath(home.home), "utf8")).toBe("[otel");
			// keyは手順5でkeychainに保存済みで、失われていない。
			expect(items.get("ws1:ingest-key")).toBe(issued.ingest_key);
			expect(home.read()).toContain("HARNESSFORCE_WORKSPACE_ID");
		});

		it("fails with the Codex message when the directory cannot be written", async () => {
			if (process.platform === "win32" || process.getuid?.() === 0) return;
			const server = await startCredentialsServer();
			const home = makeHome();
			mkdirSync(join(home.home, ".codex"));
			chmodSync(join(home.home, ".codex"), 0o500);
			const result = await runInit([], {
				homeDir: home.home,
				defaultUrl: server.base,
				openBrowser: fakeBrowser().open,
			});
			chmodSync(join(home.home, ".codex"), 0o700);
			expect(result).toEqual(failed(codexSaveFailed));
		});
	});
});

// client-updates.md「Claude Codeのplugin」: init が書く marketplace の自動更新。
describe("harnessforce init and plugin auto-update", () => {
	const SOURCE = { source: "github", repo: "lambda-script/harnessforce-agent" };
	async function initWith(settings: object, args: string[] = []) {
		const server = await startCredentialsServer();
		const home = makeHome(JSON.stringify(settings));
		const result = await runInit(args, {
			homeDir: home.home,
			defaultUrl: server.base,
			keychain: fakeKeychain({ items: EXISTING }).keychain,
			openBrowser: fakeBrowser().open,
		});
		return { result, settings: JSON.parse(home.read() ?? "{}") };
	}

	it("writes autoUpdate false and says nothing with --no-plugin-auto-update", async () => {
		const { result, settings } = await initWith({}, [
			"--no-plugin-auto-update",
		]);
		expect(result.code).toBe(0);
		expect(result.out).not.toContain(M.pluginAutoUpdateOn);
		expect(settings.extraKnownMarketplaces).toEqual({
			"harnessforce-agent": { source: SOURCE, autoUpdate: false },
		});
	});

	it("keeps a value the user chose and the source already there", async () => {
		const own = { source: "directory", path: "/opt/market" };
		const { result, settings } = await initWith({
			extraKnownMarketplaces: {
				other: { source: SOURCE },
				"harnessforce-agent": { source: own, autoUpdate: false },
			},
		});
		expect(result.out).not.toContain(M.pluginAutoUpdateOn);
		expect(settings.extraKnownMarketplaces).toEqual({
			other: { source: SOURCE },
			"harnessforce-agent": { source: own, autoUpdate: false },
		});
	});

	it("writes into additionalMarketplaces when only the alias exists", async () => {
		const { result, settings } = await initWith({
			additionalMarketplaces: { other: { source: SOURCE } },
		});
		expect(result.out).toContain(M.pluginAutoUpdateOn);
		expect(settings.extraKnownMarketplaces).toBeUndefined();
		expect(settings.additionalMarketplaces).toEqual({
			other: { source: SOURCE },
			"harnessforce-agent": { source: SOURCE, autoUpdate: true },
		});
	});
});
