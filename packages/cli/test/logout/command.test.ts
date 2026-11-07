import { chmodSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	fakeKeychain,
	LOGGED_IN_CODEX,
	LOGGED_OUT_CODEX,
	loggedInSettings,
	logoutHome,
	NOW,
	runLogout,
	sha256,
	startRevokeServer,
	TOKEN_EXPIRY,
	workspaceItems,
} from "./harness.js";

const SUCCESS =
	"Logged out of Harnessforce. Revoked the ingest key and login of this machine and removed the Harnessforce settings. Restart Claude Code and Codex to apply\n";
const NETWORK =
	"Could not log out because communication with Harnessforce failed. The login of this machine is still active. Run `harnessforce logout` again\n";
const unrevoked = (workspaceId: string) =>
	`Could not revoke the ingest key of this machine for workspace ${workspaceId} because the login had expired or was already revoked. If the key is still listed, revoke it in My ingest keys on your account page\n`;

const LOGGED_OUT_SETTINGS = {
	theme: "dark",
	env: { MY_OWN: "kept" },
	enabledPlugins: {
		"harnessforce@harnessforce-agent": false,
		"other@market": true,
	},
	extraKnownMarketplaces: loggedInSettings().extraKnownMarketplaces,
};

// 通信してはいけないtestで使う。
const noNetwork = async (): Promise<Response> => {
	throw new Error("must not send");
};

describe("harnessforce logout", () => {
	it("revokes each workspace at its own origin and removes what login wrote", async () => {
		const ws1 = await startRevokeServer("ws1");
		const ws2 = await startRevokeServer("ws2");
		const files = logoutHome({
			settings: loggedInSettings(),
			codex: LOGGED_IN_CODEX,
			device: { send_content: true },
		});
		const keychain = fakeKeychain({
			items: {
				...workspaceItems("ws1", ws1.origin),
				...workspaceItems("ws2", ws2.origin),
			},
		});

		const r = await runLogout({
			homeDir: files.home,
			keychain: keychain.keychain,
		});

		expect(r).toEqual({ code: 0, out: SUCCESS, err: "" });
		for (const [server, ws] of [
			[ws1, "ws1"],
			[ws2, "ws2"],
		] as const) {
			const revokes = server.revokes();
			expect(revokes).toHaveLength(1);
			expect(revokes[0]?.headers.authorization).toBe(
				`Bearer hf_at_${ws}_current`,
			);
			expect(JSON.parse(revokes[0]?.body ?? "")).toEqual({
				revoke_key_hashes: [sha256(`hf_ik_${ws}_user`)],
			});
		}
		expect([...keychain.items]).toEqual([]);
		expect(files.settings()).toEqual(LOGGED_OUT_SETTINGS);
		expect(files.codex()).toBe(LOGGED_OUT_CODEX);
		// 端末の本文の送信の設定は、次のloginが使うため残す。
		expect(JSON.parse(files.device() ?? "")).toEqual({ send_content: true });
	});

	it("sends an empty hash list when the workspace has no ingest key", async () => {
		const ws1 = await startRevokeServer("ws1");
		const files = logoutHome({ settings: loggedInSettings() });
		const { "ws1:ingest-key": _key, ...items } = workspaceItems(
			"ws1",
			ws1.origin,
		);
		const keychain = fakeKeychain({ items });

		const r = await runLogout({
			homeDir: files.home,
			keychain: keychain.keychain,
		});

		expect(r.code).toBe(0);
		expect(JSON.parse(ws1.revokes()[0]?.body ?? "")).toEqual({
			revoke_key_hashes: [],
		});
		expect([...keychain.items]).toEqual([]);
	});

	it("changes nothing when the revoke request cannot connect", async () => {
		const files = logoutHome({
			settings: loggedInSettings(),
			codex: LOGGED_IN_CODEX,
		});
		const items = workspaceItems("ws1", "http://127.0.0.1:9");
		const keychain = fakeKeychain({ items });
		const settingsBefore = files.settingsText();

		const r = await runLogout({
			homeDir: files.home,
			keychain: keychain.keychain,
			fetch: async () => {
				throw new TypeError("fetch failed");
			},
		});

		expect(r).toEqual({ code: 1, out: "", err: NETWORK });
		expect(Object.fromEntries(keychain.items)).toEqual(items);
		expect(files.settingsText()).toBe(settingsBefore);
		expect(files.codex()).toBe(LOGGED_IN_CODEX);
	});

	it.each([
		["a 503", { status: 503, body: { code: "gate_unavailable" } }],
		["a 400", { status: 400, body: { code: "invalid_request" } }],
		["a redirect", { status: 302 }],
	])("changes nothing on %s", async (_name, reply) => {
		const ws1 = await startRevokeServer("ws1", { revoke: () => reply });
		const files = logoutHome({ settings: loggedInSettings() });
		const items = workspaceItems("ws1", ws1.origin);
		const keychain = fakeKeychain({ items });

		const r = await runLogout({
			homeDir: files.home,
			keychain: keychain.keychain,
		});

		expect(r).toEqual({ code: 1, out: "", err: NETWORK });
		expect(Object.fromEntries(keychain.items)).toEqual(items);
		expect(files.settings()).toEqual(loggedInSettings());
	});

	it("changes nothing when the refresh cannot reach the token endpoint", async () => {
		const ws1 = await startRevokeServer("ws1");
		const files = logoutHome({ settings: loggedInSettings() });
		const items = workspaceItems("ws1", ws1.origin, {
			accessToken: new Date(NOW).toISOString(),
			refreshToken: TOKEN_EXPIRY.refreshToken,
		});
		const keychain = fakeKeychain({ items });

		const r = await runLogout({
			homeDir: files.home,
			keychain: keychain.keychain,
			fetch: async (url, init) => {
				if (url.pathname === "/oauth/token")
					throw new TypeError("fetch failed");
				return fetch(url, init);
			},
		});

		expect(r).toEqual({ code: 1, out: "", err: NETWORK });
		expect(ws1.revokes()).toEqual([]);
		expect(Object.fromEntries(keychain.items)).toEqual(items);
		expect(files.settings()).toEqual(loggedInSettings());
	});

	it("removes only the workspaces revoked before the failure", async () => {
		const ws1 = await startRevokeServer("ws1");
		const ws2 = await startRevokeServer("ws2", {
			revoke: () => ({ status: 500 }),
		});
		const files = logoutHome({ settings: loggedInSettings() });
		const ws2Items = workspaceItems("ws2", ws2.origin);
		const keychain = fakeKeychain({
			items: { ...workspaceItems("ws1", ws1.origin), ...ws2Items },
		});

		const r = await runLogout({
			homeDir: files.home,
			keychain: keychain.keychain,
		});

		expect(r).toEqual({ code: 1, out: "", err: NETWORK });
		expect(Object.fromEntries(keychain.items)).toEqual(ws2Items);
		expect(files.settings()).toEqual(loggedInSettings());
	});

	it("refreshes once on unauthorized and retries the revoke", async () => {
		const ws1 = await startRevokeServer("ws1", {
			revoke: (token) =>
				token === "hf_at_ws1_current" ? { status: 401 } : { status: 204 },
		});
		const files = logoutHome({ settings: loggedInSettings() });
		const keychain = fakeKeychain({ items: workspaceItems("ws1", ws1.origin) });

		const r = await runLogout({
			homeDir: files.home,
			keychain: keychain.keychain,
		});

		expect(r).toEqual({ code: 0, out: SUCCESS, err: "" });
		expect(ws1.revokes().map((q) => q.headers.authorization)).toEqual([
			"Bearer hf_at_ws1_current",
			"Bearer hf_at_ws1_refreshed",
		]);
		expect([...keychain.items]).toEqual([]);
	});

	it("removes the login it can no longer revoke and names the key to revoke by hand", async () => {
		const ws1 = await startRevokeServer("ws1", {
			revoke: () => ({ status: 401 }),
		});
		const files = logoutHome({ settings: loggedInSettings() });
		const keychain = fakeKeychain({ items: workspaceItems("ws1", ws1.origin) });

		const r = await runLogout({
			homeDir: files.home,
			keychain: keychain.keychain,
		});

		expect(r).toEqual({ code: 0, out: unrevoked("ws1") + SUCCESS, err: "" });
		// refresh直後のaccess tokenでも401なら、再びrefreshしない。
		expect(ws1.revokes()).toHaveLength(2);
		expect([...keychain.items]).toEqual([]);
		expect(files.settings()).toEqual(LOGGED_OUT_SETTINGS);
	});

	it("does not send an expired refresh token and still logs out", async () => {
		const files = logoutHome({ settings: loggedInSettings() });
		const keychain = fakeKeychain({
			items: workspaceItems("ws1", "https://app.example.test", {
				accessToken: new Date(NOW - 1000).toISOString(),
				refreshToken: new Date(NOW).toISOString(),
			}),
		});

		const r = await runLogout({
			homeDir: files.home,
			keychain: keychain.keychain,
			fetch: noNetwork,
		});

		expect(r).toEqual({ code: 0, out: unrevoked("ws1") + SUCCESS, err: "" });
		expect([...keychain.items]).toEqual([]);
	});

	it("treats a refresh refused with invalid_grant as a login already unusable", async () => {
		const ws1 = await startRevokeServer("ws1", {
			refresh: { status: 400, body: { error: "invalid_grant" } },
		});
		const files = logoutHome({ settings: loggedInSettings() });
		const keychain = fakeKeychain({
			items: workspaceItems("ws1", ws1.origin, {
				accessToken: new Date(NOW).toISOString(),
				refreshToken: TOKEN_EXPIRY.refreshToken,
			}),
		});

		const r = await runLogout({
			homeDir: files.home,
			keychain: keychain.keychain,
		});

		expect(r).toEqual({ code: 0, out: unrevoked("ws1") + SUCCESS, err: "" });
		expect(ws1.revokes()).toEqual([]);
	});

	it.each([
		["an ApiToken", "ws1:api-token"],
		["a url origin", "ws1:url-origin"],
	])(
		"logs out without a request when %s is missing",
		async (_name, missing) => {
			const files = logoutHome({ settings: loggedInSettings() });
			const items = workspaceItems("ws1", "https://app.example.test");
			delete items[missing];
			const keychain = fakeKeychain({ items });

			const r = await runLogout({
				homeDir: files.home,
				keychain: keychain.keychain,
				fetch: noNetwork,
			});

			expect(r).toEqual({ code: 0, out: unrevoked("ws1") + SUCCESS, err: "" });
			expect([...keychain.items]).toEqual([]);
		},
	);

	// 手順2で読めたApiTokenを読み直しで失っても、失効させないまま消さない。
	it("keeps everything when the ApiToken read in step 2 cannot be read again", async () => {
		const files = logoutHome({ settings: loggedInSettings() });
		const keychain = fakeKeychain({
			items: workspaceItems("ws1", "https://app.example.test"),
		});
		const before = [...keychain.items];

		const r = await runLogout({
			homeDir: files.home,
			keychain: { ...keychain.keychain, get: async () => undefined },
			fetch: noNetwork,
		});

		expect(r).toEqual({ code: 1, out: "", err: NETWORK });
		expect([...keychain.items]).toEqual(before);
	});

	it("does not name a key it did not have", async () => {
		const files = logoutHome({ settings: loggedInSettings() });
		const keychain = fakeKeychain({
			items: {
				"ws1:url-origin": "https://app.example.test",
				"ws1:ingest-origin": "https://ingest.example.test",
			},
		});

		const r = await runLogout({
			homeDir: files.home,
			keychain: keychain.keychain,
			fetch: noNetwork,
		});

		expect(r).toEqual({ code: 0, out: SUCCESS, err: "" });
		expect([...keychain.items]).toEqual([]);
	});

	it("ignores an ApiToken saved in an older format", async () => {
		const files = logoutHome({ settings: loggedInSettings() });
		const keychain = fakeKeychain({
			items: {
				...workspaceItems("ws1", "https://app.example.test"),
				"ws1:api-token": "hf_at_ws1_plain",
			},
		});

		const r = await runLogout({
			homeDir: files.home,
			keychain: keychain.keychain,
			fetch: noNetwork,
		});

		expect(r).toEqual({ code: 0, out: unrevoked("ws1") + SUCCESS, err: "" });
	});

	it("says there is nothing to log out without sending anything", async () => {
		const files = logoutHome({
			settings: { theme: "dark", env: { MY_OWN: "kept" } },
			codex: 'model = "o3"\n',
		});
		const keychain = fakeKeychain({ items: { "availability-probe": "x" } });

		const r = await runLogout({
			homeDir: files.home,
			keychain: keychain.keychain,
			fetch: noNetwork,
		});

		expect(r).toEqual({
			code: 0,
			out: "You are not logged in to Harnessforce, so there is nothing to log out\n",
			err: "",
		});
		expect(files.settings()).toEqual({
			theme: "dark",
			env: { MY_OWN: "kept" },
		});
		expect(files.codex()).toBe('model = "o3"\n');
	});

	it("says there is nothing to log out without settings files", async () => {
		const files = logoutHome();
		const r = await runLogout({
			homeDir: files.home,
			keychain: fakeKeychain().keychain,
			fetch: noNetwork,
		});
		expect(r.out).toBe(
			"You are not logged in to Harnessforce, so there is nothing to log out\n",
		);
		expect(files.settingsText()).toBeUndefined();
		expect(files.codex()).toBeUndefined();
	});

	it("removes the settings a stopped logout left behind", async () => {
		const files = logoutHome({
			settings: loggedInSettings(),
			codex: LOGGED_IN_CODEX,
		});

		const r = await runLogout({
			homeDir: files.home,
			keychain: fakeKeychain().keychain,
			fetch: noNetwork,
		});

		expect(r).toEqual({ code: 0, out: SUCCESS, err: "" });
		expect(files.settings()).toEqual(LOGGED_OUT_SETTINGS);
		expect(files.codex()).toBe(LOGGED_OUT_CODEX);
	});

	it("keeps an otelHeadersHelper that is not the one login wrote", async () => {
		const files = logoutHome({
			settings: { ...loggedInSettings(), otelHeadersHelper: "my-helper" },
		});

		const r = await runLogout({
			homeDir: files.home,
			keychain: fakeKeychain().keychain,
			fetch: noNetwork,
		});

		expect(r.code).toBe(0);
		expect(files.settings()).toEqual({
			...LOGGED_OUT_SETTINGS,
			otelHeadersHelper: "my-helper",
		});
	});

	it("does not create the Codex configuration", async () => {
		const files = logoutHome({ settings: loggedInSettings() });
		await runLogout({
			homeDir: files.home,
			keychain: fakeKeychain().keychain,
			fetch: noNetwork,
		});
		expect(files.codex()).toBeUndefined();
	});

	describe("before changing anything", () => {
		it("ends with the keychain message when the keychain is unavailable", async () => {
			const files = logoutHome({ settings: loggedInSettings() });

			const r = await runLogout({
				homeDir: files.home,
				keychain: fakeKeychain({ available: false, unavailableHint: "Hint" })
					.keychain,
				fetch: noNetwork,
			});

			expect(r).toEqual({
				code: 1,
				out: "",
				err: "The OS keychain is unavailable, so the ingest key cannot be saved. Hint\n",
			});
			expect(files.settings()).toEqual(loggedInSettings());
		});

		it("ends with the keychain message when the items cannot be read", async () => {
			const files = logoutHome({ settings: loggedInSettings() });

			const r = await runLogout({
				homeDir: files.home,
				keychain: fakeKeychain({ failRead: true, unavailableHint: "Hint" })
					.keychain,
				fetch: noNetwork,
			});

			expect(r).toEqual({
				code: 1,
				out: "",
				err: "The OS keychain is unavailable, so the ingest key cannot be saved\n",
			});
			expect(files.settings()).toEqual(loggedInSettings());
		});

		it.each([
			["not JSON", "{"],
			["env that is not an object", JSON.stringify({ env: [] })],
			[
				"a marketplace entry that is not an object",
				JSON.stringify({ extraKnownMarketplaces: { "harnessforce-agent": 1 } }),
			],
		])("refuses user settings with %s", async (_name, text) => {
			const files = logoutHome({ settings: text, codex: LOGGED_IN_CODEX });
			const keychain = fakeKeychain({
				items: workspaceItems("ws1", "https://app.example.test"),
			});

			const r = await runLogout({
				homeDir: files.home,
				keychain: keychain.keychain,
				fetch: noNetwork,
			});

			expect(r).toEqual({
				code: 1,
				out: "",
				err: "Cannot read the Claude Code user settings\n",
			});
			expect(keychain.items.size).toBe(4);
			expect(files.settingsText()).toBe(text);
		});

		it("refuses a Codex configuration that is not TOML", async () => {
			const files = logoutHome({
				settings: loggedInSettings(),
				codex: "[otel",
			});
			const keychain = fakeKeychain({
				items: workspaceItems("ws1", "https://app.example.test"),
			});

			const r = await runLogout({
				homeDir: files.home,
				keychain: keychain.keychain,
				fetch: noNetwork,
			});

			expect(r).toEqual({
				code: 1,
				out: "",
				err: "Cannot read the Codex configuration\n",
			});
			expect(keychain.items.size).toBe(4);
			expect(files.codex()).toBe("[otel");
		});
	});

	it("ends with the keychain removal message when the items cannot be removed", async () => {
		const ws1 = await startRevokeServer("ws1");
		const files = logoutHome({ settings: loggedInSettings() });
		const keychain = fakeKeychain({
			items: workspaceItems("ws1", ws1.origin),
			failWrite: true,
		});

		const r = await runLogout({
			homeDir: files.home,
			keychain: keychain.keychain,
		});

		expect(r).toEqual({
			code: 1,
			out: "",
			err: "Could not remove the login from the keychain. Run `harnessforce logout` again\n",
		});
		expect(files.settings()).toEqual(loggedInSettings());
	});

	// WindowsはPOSIXのpermission bitを持たず、directoryを書けなくできない。
	it.skipIf(process.platform === "win32")(
		"ends with the settings removal message when the settings cannot be written",
		async () => {
			const files = logoutHome({
				settings: loggedInSettings(),
				codex: LOGGED_IN_CODEX,
			});
			const keychain = fakeKeychain({
				items: { "ws1:ingest-key": "hf_ik_ws1_user" },
			});
			chmodSync(dirname(files.codexPath), 0o500);
			onTestFinished(() => chmodSync(dirname(files.codexPath), 0o700));

			const r = await runLogout({
				homeDir: files.home,
				keychain: keychain.keychain,
				fetch: noNetwork,
			});

			expect(r).toEqual({
				code: 1,
				out: "",
				err: "Could not remove the Harnessforce settings. Run `harnessforce logout` again\n",
			});
			// 失効は済んでいるため、keychainの項目は消えている。
			expect([...keychain.items]).toEqual([]);
			expect(files.codex()).toBe(LOGGED_IN_CODEX);
		},
	);

	it("rejects an argument with the logout usage", async () => {
		const r = await runLogout({}, ["--all"]);
		expect(r.code).toBe(2);
		expect(r.err.split("\n")[0]).toBe(
			'harnessforce logout: unknown option "--all"',
		);
		expect(r.err).toContain("Usage: harnessforce logout");
	});
});
