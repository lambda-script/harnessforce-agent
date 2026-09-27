import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import type { CliDeps } from "../../src/main.js";
import { tempDir } from "../config/support.js";
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
	access_token: "hf_at_ws1_new",
	access_token_expires_at: "2026-09-28T01:00:00.000Z",
	refresh_token: "hf_rt_ws1_new",
	refresh_token_expires_at: "2026-12-27T09:00:00+09:00",
};

// keychainの`<workspace_id>:api-token`に保存する1つのJSONのobject（correlation.md「CLI」の手順5）。
export const storedApiToken = (workspaceId: string, name: string) =>
	JSON.stringify({
		access_token: `hf_at_${workspaceId}_${name}`,
		access_token_expires_at: "2026-09-28T01:00:00Z",
		refresh_token: `hf_rt_${workspaceId}_${name}`,
		refresh_token_expires_at: "2026-12-27T00:00:00Z",
	});

// Harnessforce（apps/web）の代わり。authorization server metadataと発行のendpointだけを持つ。
export async function startHarnessforce(
	options: {
		metadata?: (base: string) => Reply;
		credentials?: Reply;
		basePath?: string;
	} = {},
) {
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
	const pages: Promise<string>[] = [];
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
					const response = await fetch(
						`${redirectUri}?${new URLSearchParams(params)}`,
					);
					return response.text();
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

export async function runInit(
	argv: string[],
	deps: Partial<CliDeps> & { homeDir: string },
) {
	return runCli(["init", ...argv], {
		keychain: fakeKeychain().keychain,
		callbackTimeoutMs: 5000,
		...deps,
	});
}
