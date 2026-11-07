import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import {
	storedToken,
	type TokenExpiry,
} from "@harnessforce/test-support/api-token";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { onTestFinished } from "vitest";
import type { CliDeps } from "../../src/main.js";
import { fakeKeychain, runCli } from "../support/cli.js";

export const NOW = Date.parse("2026-11-08T00:00:00Z");

export const sha256 = (value: string) =>
	createHash("sha256").update(value).digest("hex");

export const TOKEN_EXPIRY: TokenExpiry = {
	accessToken: new Date(NOW + 60 * 60 * 1000).toISOString(),
	refreshToken: new Date(NOW + 90 * 86_400_000).toISOString(),
};

type Reply = { status: number; body?: unknown };

type Request = {
	path: string;
	headers: IncomingHttpHeaders;
	body: string;
};

// 1つの接続先（apps/web）の代わり。authorization server metadata、token endpoint、失効のendpointだけを持つ。
export async function startRevokeServer(
	workspaceId: string,
	options: {
		// 失効の要求のaccess tokenごとの応答。無ければ204。
		revoke?: (accessToken: string) => Reply;
		refresh?: Reply;
	} = {},
) {
	const requests: Request[] = [];
	const server = createServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(chunk as Buffer);
		requests.push({
			path: `${req.method} ${req.url}`,
			headers: req.headers,
			body: Buffer.concat(chunks).toString("utf8"),
		});
		const reply = (r: Reply) =>
			res
				.writeHead(r.status, { "content-type": "application/json" })
				.end(r.body === undefined ? undefined : JSON.stringify(r.body));
		if (req.url === "/.well-known/oauth-authorization-server")
			return reply({
				status: 200,
				body: {
					issuer: origin,
					authorization_endpoint: `${origin}/oauth/authorize`,
					token_endpoint: `${origin}/oauth/token`,
				},
			});
		if (req.method === "POST" && req.url === "/oauth/token")
			return reply(
				options.refresh ?? {
					status: 200,
					body: JSON.parse(storedToken(workspaceId, "refreshed", TOKEN_EXPIRY)),
				},
			);
		if (req.method === "POST" && req.url === "/api/v1/cli/credentials/revoke") {
			const bearer = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
			return reply(options.revoke?.(bearer) ?? { status: 204 });
		}
		reply({ status: 404 });
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	onTestFinished(() => {
		server.closeAllConnections();
		server.close();
	});
	const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const revokes = () =>
		requests.filter((r) => r.path === "POST /api/v1/cli/credentials/revoke");
	return { origin, requests, revokes };
}

// `harnessforce login`がWorkspaceごとに保存する4つの項目。
export function workspaceItems(
	workspaceId: string,
	urlOrigin: string,
	expiry: TokenExpiry = TOKEN_EXPIRY,
): Record<string, string> {
	return {
		[`${workspaceId}:ingest-key`]: `hf_ik_${workspaceId}_user`,
		[`${workspaceId}:api-token`]: storedToken(workspaceId, "current", expiry),
		[`${workspaceId}:ingest-origin`]: "https://ingest.example.test",
		[`${workspaceId}:url-origin`]: urlOrigin,
	};
}

// `harnessforce login`が書いたuser settings。利用者の他の鍵も持つ。
export const loggedInSettings = (workspaceId = "ws1") => ({
	theme: "dark",
	env: {
		HARNESSFORCE_URL: "https://app.example.test",
		HARNESSFORCE_ENDPOINT: "https://ingest.example.test",
		OTEL_EXPORTER_OTLP_ENDPOINT: "https://ingest.example.test",
		HARNESSFORCE_WORKSPACE_ID: workspaceId,
		CLAUDE_CODE_ENABLE_TELEMETRY: "1",
		CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
		OTEL_METRICS_INCLUDE_ENTRYPOINT: "true",
		OTEL_METRICS_EXPORTER: "otlp",
		OTEL_LOGS_EXPORTER: "otlp",
		OTEL_TRACES_EXPORTER: "otlp",
		OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
		OTEL_LOGS_EXPORT_INTERVAL: "60000",
		OTEL_TRACES_EXPORT_INTERVAL: "60000",
		OTEL_METRIC_EXPORT_INTERVAL: "60000",
		OTEL_LOG_USER_PROMPTS: "1",
		OTEL_LOG_ASSISTANT_RESPONSES: "1",
		OTEL_LOG_TOOL_DETAILS: "1",
		OTEL_LOG_TOOL_CONTENT: "1",
		MY_OWN: "kept",
	},
	otelHeadersHelper: "harnessforce otel-headers",
	enabledPlugins: {
		"harnessforce@harnessforce-agent": true,
		"other@market": true,
	},
	extraKnownMarketplaces: {
		"harnessforce-agent": {
			source: { source: "github", repo: "lambda-script/harnessforce-agent" },
			autoUpdate: true,
		},
	},
});

// `harnessforce login`が書いたCodexの`config.toml`。利用者の他の設定も持つ。
export const LOGGED_IN_CODEX = `model = "o3"

[otel]
environment = "dev"
log_user_prompt = true
log_agent_responses = true

[otel.exporter.otlp-http]
endpoint = "https://ingest.example.test"
protocol = "binary"

[otel.exporter.otlp-http.headers]
Authorization = "Bearer hf_ik_ws1_user"

[[hooks.SessionStart]]
[[hooks.SessionStart.hooks]]
type = "command"
command = "my-own-hook"

[[hooks.SessionStart.hooks]]
type = "command"
command = "harnessforce hook session-start"
commandWindows = "harnessforce.cmd hook session-start"
timeout = 10

[[hooks.PostToolUse]]
matcher = "^apply_patch$"

[[hooks.PostToolUse.hooks]]
type = "command"
command = "harnessforce hook post-tool-use"
commandWindows = "harnessforce.cmd hook post-tool-use"
timeout = 10
async = true

[[hooks.Stop]]
[[hooks.Stop.hooks]]
type = "command"
command = "harnessforce hook stop"
commandWindows = "harnessforce.cmd hook stop"
timeout = 10
async = true

[mcp_servers.other]
url = "https://other.example.test/mcp"

[mcp_servers.harnessforce]
url = "https://app.example.test/mcp"
`;

export const LOGGED_OUT_CODEX = `model = "o3"

[otel]
environment = "dev"

[[hooks.SessionStart]]
[[hooks.SessionStart.hooks]]
type = "command"
command = "my-own-hook"

[mcp_servers.other]
url = "https://other.example.test/mcp"
`;

// home directoryとそのfile。値がundefinedのfileは作らない。
export function logoutHome(
	files: { settings?: unknown; codex?: string; device?: unknown } = {},
) {
	const home = tempDir("hf-home-");
	const settingsPath = join(home, ".claude", "settings.json");
	const codexPath = join(home, ".codex", "config.toml");
	const devicePath = join(home, ".harnessforce", "config.json");
	const write = (path: string, text: string) => {
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, text);
	};
	if (files.settings !== undefined)
		write(
			settingsPath,
			typeof files.settings === "string"
				? files.settings
				: JSON.stringify(files.settings),
		);
	if (files.codex !== undefined) write(codexPath, files.codex);
	if (files.device !== undefined)
		write(devicePath, JSON.stringify(files.device));
	const read = (path: string) =>
		existsSync(path) ? readFileSync(path, "utf8") : undefined;
	return {
		home,
		settingsPath,
		codexPath,
		devicePath,
		settings: () => JSON.parse(read(settingsPath) ?? "null"),
		settingsText: () => read(settingsPath),
		codex: () => read(codexPath),
		device: () => read(devicePath),
	};
}

export { fakeKeychain };

export function runLogout(deps: Partial<CliDeps>, argv: string[] = []) {
	return runCli(["logout", ...argv], {
		now: () => new Date(NOW),
		...deps,
	});
}
