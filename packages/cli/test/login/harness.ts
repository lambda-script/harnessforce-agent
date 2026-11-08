import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { TokenExpiry } from "@harnessforce/test-support/api-token";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { onTestFinished } from "vitest";
import type { CliDeps } from "../../src/main.js";
import { fakeKeychain, runCli } from "../support/cli.js";

export const sha256 = (value: string) =>
	createHash("sha256").update(value).digest("hex");

type Reply = {
	status: number;
	body?: unknown;
	headers?: Record<string, string>;
};

export const issued = {
	workspace_id: "ws1",
	ingest_key: "hf_ik_ws1_new",
	ingest_endpoint: "https://ingest.example.test/base",
	content: {
		prompts: false,
		model_and_tools: false,
		visibility: "all_members",
		retention_days: 30,
	},
	access_token: "hf_at_ws1_new",
	access_token_expires_at: "2026-09-28T01:00:00.000Z",
	refresh_token: "hf_rt_ws1_new",
	refresh_token_expires_at: "2026-12-27T09:00:00+09:00",
};

// keychainに既にある`<workspace_id>:api-token`の期限。
export const TOKEN_EXPIRY: TokenExpiry = {
	accessToken: "2026-09-28T01:00:00Z",
	refreshToken: "2026-12-27T00:00:00Z",
};

// Harnessforce（apps/web）の代わり。authorization server metadata、発行のendpoint、
// 成功の後に最後の行を決めるRead APIの2つ（repositoriesとonboarding。既定は404）を持つ。
export async function startCredentialsServer(
	options: {
		metadata?: (base: string) => Reply;
		credentials?: Reply;
		basePath?: string;
		// `GET /api/v1/repositories`のページ。2ページ目以降はcursorで要求される。
		repositories?: Reply[];
		onboarding?: Reply;
		// Read APIへ応答する前に待つ。loopbackの応答の前に読んでいないかを確かめる。
		beforeRead?: () => Promise<unknown>;
	} = {},
) {
	const readRequests: { url: string; authorization: string | undefined }[] = [];
	const credentialRequests: { headers: IncomingHttpHeaders; body: unknown }[] =
		[];
	let metadataRequests: string[] = [];
	const basePath = options.basePath ?? "";
	const server = createServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(chunk as Buffer);
		const reply = (r: Reply) =>
			res
				.writeHead(r.status, {
					"content-type": "application/json",
					...r.headers,
				})
				.end(r.body === undefined ? undefined : JSON.stringify(r.body));
		if (req.method === "GET" && req.url?.startsWith("/.well-known/")) {
			metadataRequests = [...metadataRequests, req.url];
			return reply(
				options.metadata?.(base) ?? {
					status: 200,
					body: {
						issuer: base,
						authorization_endpoint: `${base}/oauth/authorize`,
					},
				},
			);
		}
		if (
			req.method === "POST" &&
			req.url === `${basePath}/api/v1/cli/credentials`
		) {
			credentialRequests.push({
				headers: req.headers,
				body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
			});
			return reply(options.credentials ?? { status: 201, body: issued });
		}
		const readPath = req.url?.split("?")[0];
		if (
			req.method === "GET" &&
			(readPath === `${basePath}/api/v1/repositories` ||
				readPath === `${basePath}/api/v1/onboarding`)
		) {
			readRequests.push({
				url: req.url ?? "",
				authorization: req.headers.authorization,
			});
			await options.beforeRead?.();
			if (readPath === `${basePath}/api/v1/onboarding`)
				return reply(options.onboarding ?? { status: 404 });
			const cursor = new URL(req.url ?? "", "http://x").searchParams.get(
				"cursor",
			);
			const page = cursor === null ? 0 : Number(cursor);
			return reply(options.repositories?.[page] ?? { status: 404 });
		}
		reply({ status: 404 });
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	onTestFinished(() => {
		server.closeAllConnections();
		server.close();
	});
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${basePath}`;
	return {
		base,
		credentialRequests,
		readRequests,
		metadataRequests: () => metadataRequests,
	};
}

type BrowserOptions = {
	// callbackのqueryを決める。stateは既定でauthorization requestの値を返す。
	// 値がundefinedの鍵はqueryに含めない。
	query?: (authorization: URL) => Record<string, string | undefined>;
	opens?: boolean;
	favicon?: boolean;
	beforeCallback?: () => void;
	callback?: false;
};

// ブラウザとログインの画面の代わり。authorization requestのredirect_uriへcallbackを送る。
export function fakeBrowser(options: BrowserOptions = {}) {
	const opened: URL[] = [];
	const pages: Promise<{
		status: number;
		location: string | null;
		cacheControl: string | null;
		body: string;
	}>[] = [];
	const open = async (url: string) => {
		const authorization = new URL(url);
		opened.push(authorization);
		if (options.callback !== false) {
			const redirectUri = authorization.searchParams.get("redirect_uri") ?? "";
			const query = options.query?.(authorization) ?? {
				code: "code-1",
				state: authorization.searchParams.get("state") ?? "",
			};
			pages.push(
				(async () => {
					if (options.favicon)
						await fetch(new URL("/favicon.ico", redirectUri));
					options.beforeCallback?.();
					const params = Object.entries(query).filter(
						(entry): entry is [string, string] => entry[1] !== undefined,
					);
					// 完了画面への303を辿らず、応答そのものを返す。
					const response = await fetch(
						`${redirectUri}?${new URLSearchParams(params)}`,
						{ redirect: "manual" },
					);
					return {
						status: response.status,
						location: response.headers.get("location"),
						cacheControl: response.headers.get("cache-control"),
						body: await response.text(),
					};
				})(),
			);
		}
		return options.opens ?? true;
	};
	return { open, opened, pages };
}

export function makeHome(settings?: string) {
	const home = tempDir("hf-home-");
	const path = join(home, ".claude/settings.json");
	if (settings !== undefined) {
		mkdirSync(join(home, ".claude"));
		writeFileSync(path, settings);
	}
	return {
		home,
		path,
		read: () => (existsSync(path) ? readFileSync(path, "utf8") : undefined),
	};
}

export async function runLogin(
	argv: string[],
	deps: Partial<CliDeps> & { homeDir: string },
) {
	return runCli(["login", ...argv], {
		keychain: fakeKeychain().keychain,
		callbackTimeoutMs: 5000,
		...deps,
	});
}
