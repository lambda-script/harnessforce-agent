import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import { importStatePath } from "../../src/import/state.js";
import type { CliDeps } from "../../src/main.js";
import { tempDir } from "../config/support.js";
import { fakeKeychain, runCli } from "../support/cli.js";

export const NOW = Date.parse("2026-09-27T00:00:00Z");

type Reply = {
	status: number;
	body?: unknown;
	headers?: Record<string, string>;
};

type Request = {
	path: string;
	headers: IncomingHttpHeaders;
	body: unknown;
};

type HarnessforceOptions = {
	// cursorごとのrepositoryの一覧。無ければ1ページで`github.com/acme/web`だけ。
	repositories?: (cursor: string | null) => Reply;
	workspace?: Reply;
	// ingestの要求ごとの応答。尽きたらすべて受け付ける。
	ingest?: Reply[];
};

// Harnessforceの代わり。Read API（/app）とingest（/ingest）を同じportで持つ。
export async function startHarnessforce(options: HarnessforceOptions = {}) {
	const requests: Request[] = [];
	const ingestReplies = [...(options.ingest ?? [])];
	const server = createServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(chunk as Buffer);
		const text = Buffer.concat(chunks).toString("utf8");
		const url = new URL(req.url ?? "/", "http://localhost");
		requests.push({
			path: `${req.method} ${url.pathname}${url.search}`,
			headers: req.headers,
			body: text ? JSON.parse(text) : undefined,
		});
		const reply = (r: Reply) =>
			res
				.writeHead(r.status, {
					"content-type": "application/json",
					...r.headers,
				})
				.end(r.body === undefined ? undefined : JSON.stringify(r.body));
		if (req.method === "GET" && url.pathname === "/app/api/v1/repositories")
			return reply(
				options.repositories?.(url.searchParams.get("cursor")) ?? {
					status: 200,
					body: {
						data: [{ repository: "github.com/acme/web" }],
						next_cursor: null,
					},
				},
			);
		if (req.method === "GET" && url.pathname === "/app/api/v1/workspace")
			return reply(
				options.workspace ?? { status: 200, body: { session_import_days: 30 } },
			);
		if (req.method === "POST" && url.pathname === "/ingest/v1/imports/sessions")
			return reply(
				ingestReplies.shift() ?? {
					status: 200,
					body: {
						accepted: (JSON.parse(text) as unknown[]).length,
						rejected: [],
					},
				},
			);
		reply({ status: 404 });
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	onTestFinished(() => {
		server.closeAllConnections();
		server.close();
	});
	const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const sessionBodies = () =>
		requests
			.filter((r) => r.path.startsWith("POST "))
			.map((r) =>
				(r.body as { session_id: string }[]).map((s) => s.session_id),
			);
	return {
		origin,
		appUrl: `${origin}/app`,
		ingestUrl: `${origin}/ingest`,
		requests,
		sessionBodies,
	};
}

// origin remoteを持つgitのrepository。sessionのcwdに使う。
export function gitRepository(remote = "git@github.com:Acme/Web.git"): string {
	const dir = tempDir("hf-work-");
	execFileSync("git", ["init", "-q", dir]);
	execFileSync("git", ["-C", dir, "remote", "add", "origin", remote]);
	return dir;
}

const line = (value: unknown) => `${JSON.stringify(value)}\n`;

// Claude Codeのtranscriptの最小の形。本文にはSECRETを入れ、送られないことを確かめる。
export function transcript(
	sessionId: string,
	cwd: string,
	endedAt = "2026-09-20T01:00:00Z",
): string {
	return (
		line({
			type: "user",
			sessionId,
			cwd,
			gitBranch: "eng-42-login",
			promptId: `prompt-${sessionId}`,
			timestamp: "2026-09-20T00:00:00Z",
			message: { role: "user", content: "SECRET prompt" },
		}) +
		line({
			type: "assistant",
			sessionId,
			cwd,
			timestamp: endedAt,
			message: {
				id: `msg-${sessionId}`,
				model: "claude-opus-5-5",
				usage: { input_tokens: 10, output_tokens: 2 },
				content: [{ type: "text", text: "SECRET response" }],
			},
		})
	);
}

// hf initを終えた端末のhome。user settingsのenvに宛先とWorkspaceを持つ。
export function initializedHome(
	env: Record<string, string>,
	sessions: Record<string, string> = {},
) {
	const home = tempDir("hf-home-");
	mkdirSync(join(home, ".claude"));
	writeFileSync(
		join(home, ".claude", "settings.json"),
		JSON.stringify({ env }),
	);
	for (const [id, content] of Object.entries(sessions)) {
		const dir = join(home, ".claude", "projects", "-work-web");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, `${id}.jsonl`), content);
	}
	const statePath = importStatePath(home);
	return {
		home,
		statePath,
		readState: () =>
			existsSync(statePath) ? readFileSync(statePath, "utf8") : undefined,
	};
}

export function initializedKeychain(
	origin: string,
	workspaces: readonly string[] = ["ws1"],
	extra: Record<string, string> = {},
) {
	const items: Record<string, string> = {};
	for (const ws of workspaces) {
		items[`${ws}:ingest-key`] = `hf_ik_${ws}_user`;
		items[`${ws}:api-token`] = `hf_at_${ws}`;
		items[`${ws}:ingest-origin`] = origin;
		// このharnessは接続先とingestを同じserverで受けるため、どちらのoriginも同じ値になる。
		items[`${ws}:url-origin`] = origin;
	}
	return fakeKeychain({ items: { ...items, ...extra } });
}

export function runImport(deps: Partial<CliDeps>) {
	return runCli(["import"], {
		defaultUrl: "https://default.example.test",
		now: () => new Date(NOW),
		...deps,
	});
}
