import {
	existsSync,
	mkdirSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname } from "node:path";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { describe, expect, it, onTestFinished } from "vitest";
import {
	createApiTokenSession,
	tokenLockPath,
} from "../../src/credentials/api-token-session.js";
import { fakeKeychain } from "../support/cli.js";

const NOW = Date.parse("2026-09-28T00:00:00Z");
const HOUR = 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

const token = (name: string, accessExpiresAt = NOW + HOUR) => ({
	access_token: `hf_at_ws1_${name}`,
	access_token_expires_at: iso(accessExpiresAt),
	refresh_token: `hf_rt_ws1_${name}`,
	refresh_token_expires_at: iso(NOW + 90 * 24 * HOUR),
});

type Reply = { status: number; body?: unknown };

// apps/webの代わり。authorization server metadataとtoken endpointだけを持つ。
async function startAuthorizationServer(
	options: {
		refresh?: (form: URLSearchParams) => Reply | Promise<Reply>;
		tokenEndpoint?: (base: string) => string;
	} = {},
) {
	const refreshForms: URLSearchParams[] = [];
	const server = createServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(chunk as Buffer);
		const reply = (r: Reply) =>
			res
				.writeHead(r.status, { "content-type": "application/json" })
				.end(r.body === undefined ? undefined : JSON.stringify(r.body));
		if (req.url === "/.well-known/oauth-authorization-server")
			return reply({
				status: 200,
				body: {
					issuer: base,
					authorization_endpoint: `${base}/oauth/authorize`,
					token_endpoint:
						options.tokenEndpoint?.(base) ?? `${base}/oauth/token`,
				},
			});
		if (req.method === "POST" && req.url === "/oauth/token") {
			const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
			refreshForms.push(form);
			return reply(
				(await options.refresh?.(form)) ?? {
					status: 200,
					body: { ...token("refreshed", NOW + 2 * HOUR), token_type: "Bearer" },
				},
			);
		}
		reply({ status: 404 });
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	onTestFinished(() => {
		server.closeAllConnections();
		server.close();
	});
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return { base, refreshForms };
}

function session(
	base: string,
	stored: unknown,
	options: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
) {
	const home = tempDir("hf-home-");
	const keychain = fakeKeychain({
		items:
			stored === undefined
				? {}
				: {
						"ws1:api-token":
							typeof stored === "string" ? stored : JSON.stringify(stored),
					},
	});
	const tokens = createApiTokenSession({
		keychain: keychain.keychain,
		workspaceId: "ws1",
		readBase: new URL(base),
		fetch: (url, init) => fetch(url, init),
		now: options.now ?? (() => NOW),
		sleep: options.sleep ?? (async () => {}),
		homeDir: home,
	});
	const stored1 = () =>
		JSON.parse(keychain.items.get("ws1:api-token") ?? "null");
	return { tokens, keychain, home, stored: stored1 };
}

// Read APIの代わり。401を返す access token を決める。
const readApi =
	(unauthorized: readonly string[] = [], used: string[] = []) =>
	async (accessToken: string) => {
		used.push(accessToken);
		return unauthorized.includes(accessToken) ? 401 : 200;
	};
const isUnauthorized = (status: number) => status === 401;

describe("an ApiToken session", () => {
	it("uses the stored access token while it is valid", async () => {
		const server = await startAuthorizationServer();
		const { tokens } = session(server.base, token("old"));
		const used: string[] = [];

		expect(await tokens.withToken(readApi([], used), isUnauthorized)).toEqual({
			kind: "ok",
			value: 200,
		});
		expect(used).toEqual(["hf_at_ws1_old"]);
		expect(server.refreshForms).toEqual([]);
	});

	it("refreshes an expired access token first and stores the new pair", async () => {
		const server = await startAuthorizationServer();
		const { tokens, stored, home } = session(server.base, token("old", NOW));
		const used: string[] = [];

		expect(await tokens.withToken(readApi([], used), isUnauthorized)).toEqual({
			kind: "ok",
			value: 200,
		});
		expect(used).toEqual(["hf_at_ws1_refreshed"]);
		expect(server.refreshForms.map((form) => Object.fromEntries(form))).toEqual(
			[
				{
					grant_type: "refresh_token",
					refresh_token: "hf_rt_ws1_old",
					client_id: "harnessforce-cli",
				},
			],
		);
		expect(stored()).toEqual(token("refreshed", NOW + 2 * HOUR));
		// lockは終えたら消す。directoryは所有者だけが読める。
		expect(existsSync(tokenLockPath(home))).toBe(false);
		// WindowsはPOSIXのpermission bitを持たず、modeが常に0o666系になる。
		if (process.platform !== "win32")
			expect(statSync(dirname(tokenLockPath(home))).mode & 0o777).toBe(0o700);
	});

	it("refreshes once on unauthorized and retries the same request", async () => {
		const server = await startAuthorizationServer();
		const { tokens } = session(server.base, token("old"));
		const used: string[] = [];

		expect(
			await tokens.withToken(readApi(["hf_at_ws1_old"], used), isUnauthorized),
		).toEqual({ kind: "ok", value: 200 });
		expect(used).toEqual(["hf_at_ws1_old", "hf_at_ws1_refreshed"]);
	});

	it("ends as expired when the refreshed access token is also unauthorized", async () => {
		const server = await startAuthorizationServer();
		const { tokens } = session(server.base, token("old"));

		expect(
			await tokens.withToken(
				readApi(["hf_at_ws1_old", "hf_at_ws1_refreshed"]),
				isUnauthorized,
			),
		).toEqual({ kind: "expired" });
		expect(server.refreshForms).toHaveLength(1);
	});

	it("keeps using the refreshed token for later requests", async () => {
		const server = await startAuthorizationServer();
		const { tokens } = session(server.base, token("old", NOW));
		const used: string[] = [];

		await tokens.withToken(readApi([], used), isUnauthorized);
		await tokens.withToken(readApi([], used), isUnauthorized);

		expect(used).toEqual(["hf_at_ws1_refreshed", "hf_at_ws1_refreshed"]);
		expect(server.refreshForms).toHaveLength(1);
	});

	it.each([
		["nothing stored", undefined],
		["a value from an older harnessforce init", "hf_at_ws1_plain"],
		[
			"a token of another workspace",
			{ ...token("x"), access_token: "hf_at_ws2_x" },
		],
	])("reports %s as missing without calling the Read API", async (_name, stored) => {
		const server = await startAuthorizationServer();
		const used: string[] = [];

		expect(
			await session(server.base, stored).tokens.withToken(
				readApi([], used),
				isUnauthorized,
			),
		).toEqual({ kind: "missing" });
		expect(used).toEqual([]);
	});
});

describe("refresh failures", () => {
	it("ends as expired on invalid_grant when no other process saved a token", async () => {
		const server = await startAuthorizationServer({
			refresh: () => ({ status: 400, body: { error: "invalid_grant" } }),
		});
		const { tokens, stored } = session(server.base, token("old", NOW));

		expect(await tokens.withToken(readApi(), isUnauthorized)).toEqual({
			kind: "expired",
		});
		expect(stored()).toEqual(token("old", NOW));
	});

	it("continues with the token another process saved when its refresh got invalid_grant", async () => {
		let keychainItems: Map<string, string> | undefined;
		const server = await startAuthorizationServer({
			refresh: () => {
				keychainItems?.set("ws1:api-token", JSON.stringify(token("other")));
				return { status: 400, body: { error: "invalid_grant" } };
			},
		});
		const { tokens, keychain } = session(server.base, token("old", NOW));
		keychainItems = keychain.items;
		const used: string[] = [];

		expect(await tokens.withToken(readApi([], used), isUnauthorized)).toEqual({
			kind: "ok",
			value: 200,
		});
		expect(used).toEqual(["hf_at_ws1_other"]);
	});

	it("does not send an expired refresh token", async () => {
		const server = await startAuthorizationServer();
		const expired = {
			...token("old", NOW),
			refresh_token_expires_at: iso(NOW),
		};

		expect(
			await session(server.base, expired).tokens.withToken(
				readApi(),
				isUnauthorized,
			),
		).toEqual({ kind: "expired" });
		expect(server.refreshForms).toEqual([]);
	});

	it.each([
		["a 500", { status: 500 }],
		[
			"a token of another workspace",
			{ status: 200, body: { ...token("n"), refresh_token: "hf_rt_ws2_n" } },
		],
		[
			"an instant without offset",
			{
				status: 200,
				body: { ...token("n"), access_token_expires_at: "2026-09-28T01:00:00" },
			},
		],
	])("ends as expired on %s and keeps the stored token", async (_name, reply) => {
		const server = await startAuthorizationServer({ refresh: () => reply });
		const { tokens, stored } = session(server.base, token("old", NOW));

		expect(await tokens.withToken(readApi(), isUnauthorized)).toEqual({
			kind: "expired",
		});
		expect(stored()).toEqual(token("old", NOW));
	});

	it("does not send the refresh token to a token endpoint on another origin", async () => {
		const server = await startAuthorizationServer({
			tokenEndpoint: () => "https://evil.example.test/oauth/token",
		});
		const fetched: string[] = [];
		const home = tempDir("hf-home-");
		const tokens = createApiTokenSession({
			keychain: fakeKeychain({
				items: { "ws1:api-token": JSON.stringify(token("old", NOW)) },
			}).keychain,
			workspaceId: "ws1",
			readBase: new URL(server.base),
			fetch: (url, init) => {
				fetched.push(url.href);
				return fetch(url, init);
			},
			now: () => NOW,
			sleep: async () => {},
			homeDir: home,
		});

		expect(await tokens.withToken(readApi(), isUnauthorized)).toEqual({
			kind: "expired",
		});
		expect(fetched).toEqual([
			`${server.base}/.well-known/oauth-authorization-server`,
		]);
	});
});

describe("the refresh lock", () => {
	it("uses the token another process refreshed while waiting for the lock", async () => {
		const server = await startAuthorizationServer();
		let clock = NOW;
		const { tokens, keychain, home } = session(server.base, token("old", NOW), {
			now: () => clock,
			sleep: async (ms) => {
				clock += ms;
				// 別のprocessがrefreshを終えてlockを外す。
				keychain.items.set("ws1:api-token", JSON.stringify(token("other")));
				await import("node:fs/promises").then((fs) =>
					fs.rm(tokenLockPath(home), { force: true }),
				);
			},
		});
		mkdirSync(dirname(tokenLockPath(home)), { recursive: true });
		writeFileSync(tokenLockPath(home), "");
		utimesSync(tokenLockPath(home), NOW / 1000, NOW / 1000);
		const used: string[] = [];

		expect(await tokens.withToken(readApi([], used), isUnauthorized)).toEqual({
			kind: "ok",
			value: 200,
		});
		expect(used).toEqual(["hf_at_ws1_other"]);
		expect(server.refreshForms).toEqual([]);
	});

	it("ends as expired when the lock is not released within 30 seconds", async () => {
		const server = await startAuthorizationServer();
		let clock = NOW;
		const { tokens, home } = session(server.base, token("old", NOW), {
			now: () => clock,
			sleep: async (ms) => {
				clock += ms;
			},
		});
		mkdirSync(dirname(tokenLockPath(home)), { recursive: true });
		writeFileSync(tokenLockPath(home), "");
		utimesSync(tokenLockPath(home), NOW / 1000, NOW / 1000);

		expect(await tokens.withToken(readApi(), isUnauthorized)).toEqual({
			kind: "expired",
		});
		expect(clock - NOW).toBeGreaterThanOrEqual(30_000);
		expect(server.refreshForms).toEqual([]);
	});

	it("removes a lock left for more than 60 seconds and refreshes", async () => {
		const server = await startAuthorizationServer();
		const { tokens, home } = session(server.base, token("old", NOW));
		mkdirSync(dirname(tokenLockPath(home)), { recursive: true });
		writeFileSync(tokenLockPath(home), "");
		const leftAt = (NOW - 61_000) / 1000;
		utimesSync(tokenLockPath(home), leftAt, leftAt);

		expect(await tokens.withToken(readApi(), isUnauthorized)).toEqual({
			kind: "ok",
			value: 200,
		});
		expect(server.refreshForms).toHaveLength(1);
	});
});
