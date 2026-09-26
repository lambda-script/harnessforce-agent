import { execFileSync, spawn } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
} from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

// turboはtestの前にこのpackageのbuildを実行する。直接vitestを実行する場合は先に`pnpm build`する。
const built = fileURLToPath(new URL("../dist/marketplace", import.meta.url));
// buildの出力をnode_modulesの無い場所へ写し、bundleが依存packageを実行時に解決しないことも確かめる。
let marketplace: string;
let hookScript: string;
beforeAll(() => {
	marketplace = join(mkdtempSync(join(tmpdir(), "hf-marketplace-")), "out");
	cpSync(built, marketplace, { recursive: true });
	hookScript = join(
		marketplace,
		"plugins/harnessforce/scripts/harnessforce-hook.cjs",
	);
});

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
// test用のidentityはenvで渡し、git configへ書かない。
const identity = {
	GIT_AUTHOR_NAME: "hook-test",
	GIT_AUTHOR_EMAIL: "hook-test@example.test",
	GIT_COMMITTER_NAME: "hook-test",
	GIT_COMMITTER_EMAIL: "hook-test@example.test",
};
const withoutGitVariables = (env: NodeJS.ProcessEnv) =>
	Object.fromEntries(
		Object.entries(env).filter(([name]) => !name.startsWith("GIT_")),
	);
const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

function makeRepo() {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "hf-repo-")));
	const git = (...args: string[]) =>
		execFileSync("git", ["-C", dir, ...args], {
			// 実行中の環境のGIT_DIRなどでtestの外のrepositoryを触らない。
			env: { ...withoutGitVariables(process.env), ...identity },
		})
			.toString()
			.trim();
	git("init", "-q", "-b", "eng-42-login");
	git("remote", "add", "origin", "git@github.com:Acme/Web.git");
	git(
		"-c",
		"commit.gpgsign=false",
		"commit",
		"-q",
		"--allow-empty",
		"-m",
		"init",
	);
	return { dir, head: git("rev-parse", "HEAD") };
}

type Reply = "accept" | "revoke" | "hang";

async function startIngest(reply: Reply) {
	const received: {
		url?: string;
		headers: IncomingHttpHeaders;
		body: unknown;
	}[] = [];
	const server = createServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(chunk as Buffer);
		received.push({
			url: req.url,
			headers: req.headers,
			body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
		});
		if (reply === "hang") return;
		if (reply === "revoke") return res.writeHead(401).end();
		res
			.writeHead(200, { "content-type": "application/json" })
			.end(JSON.stringify({ accepted: 1, rejected: [] }));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	cleanups.push(() => {
		server.closeAllConnections();
		server.close();
	});
	const { port } = server.address() as AddressInfo;
	return { endpoint: `http://127.0.0.1:${port}/base/`, received };
}

function runBundle(event: string, input: object, env: Record<string, string>) {
	return new Promise<{
		code: number | null;
		stdout: string;
		stderr: string;
		elapsedMs: number;
	}>((resolve) => {
		const began = Date.now();
		const child = spawn(process.execPath, [hookScript, event], {
			env: { PATH: process.env.PATH ?? "", ...env },
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("close", (code) =>
			resolve({ code, stdout, stderr, elapsedMs: Date.now() - began }),
		);
		child.stdin.end(JSON.stringify(input));
	});
}

const env = (endpoint: string) => ({
	HARNESSFORCE_ENDPOINT: endpoint,
	HARNESSFORCE_INGEST_KEY: "hf_ik_ws1_secret",
});

describe("built marketplace", () => {
	it("is a local marketplace that lists the harnessforce plugin", () => {
		expect(
			readJson(join(marketplace, ".claude-plugin/marketplace.json")),
		).toEqual(
			readJson(
				fileURLToPath(
					new URL("../../../.claude-plugin/marketplace.json", import.meta.url),
				),
			),
		);
		expect(
			readJson(
				join(marketplace, "plugins/harnessforce/.claude-plugin/plugin.json"),
			),
		).toMatchObject({ name: "harnessforce" });
	});

	it.each([
		["SessionStart", "session-start"],
		["UserPromptSubmit", "user-prompt-submit"],
	])("runs the bundled hook for %s in exec form", (event, arg) => {
		const { hooks } = readJson(
			join(marketplace, "plugins/harnessforce/hooks/hooks.json"),
		);
		// Claude Codeが展開するplaceholderであり、JSのtemplateではない。
		const pluginRoot = ["$", "{CLAUDE_PLUGIN_ROOT}"].join("");
		expect(hooks[event]).toEqual([
			{
				hooks: [
					{
						type: "command",
						command: "node",
						args: [`${pluginRoot}/scripts/harnessforce-hook.cjs`, arg],
						timeout: 10,
					},
				],
			},
		]);
		expect(existsSync(hookScript)).toBe(true);
	});
});

describe("bundled hook", () => {
	it("registers a real git repository and its first prompt through HTTP", async () => {
		const repo = makeRepo();
		const ingest = await startIngest("accept");
		const pad = mkdtempSync(join(tmpdir(), "hf-scratch-"));
		const input = { session_id: "s-1", cwd: repo.dir, scratchpad_dir: pad };
		// 利用者の環境のGIT_DIRではなく、cwdのrepositoryを登録する。
		const started = await runBundle(
			"session-start",
			{ ...input, source: "startup" },
			{ ...env(ingest.endpoint), GIT_DIR: join(pad, "not-a-repo") },
		);
		const prompted = await runBundle(
			"user-prompt-submit",
			{ ...input, prompt_id: "p-1" },
			env(ingest.endpoint),
		);
		for (const result of [started, prompted])
			expect(result).toMatchObject({ code: 0, stdout: "", stderr: "" });
		expect(ingest.received.map((r) => r.url)).toEqual([
			"/base/v1/sessions",
			"/base/v1/sessions",
		]);
		expect(ingest.received[0]?.headers.authorization).toBe(
			"Bearer hf_ik_ws1_secret",
		);
		const registration = {
			agent: "claude_code",
			session_id: "s-1",
			repository: "github.com/acme/web",
			branch: "eng-42-login",
			commit: repo.head,
			source: "hook",
			started_at: expect.stringMatching(/Z$/),
		};
		expect(ingest.received.map((r) => r.body)).toEqual([
			[registration],
			[{ ...registration, first_prompt_id: "p-1" }],
		]);
	});

	it("shows the revoked-key notice on 401 and exits 0", async () => {
		const repo = makeRepo();
		const ingest = await startIngest("revoke");
		const result = await runBundle(
			"session-start",
			{ session_id: "s-1", cwd: repo.dir },
			env(ingest.endpoint),
		);
		expect(result.code).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({
			systemMessage:
				"組織の送信キーが失効しています。Workspaceの管理者に連絡してください",
		});
	});

	it("gives up after the 2 second budget when the server hangs", async () => {
		const repo = makeRepo();
		const ingest = await startIngest("hang");
		const result = await runBundle(
			"session-start",
			{ session_id: "s-1", cwd: repo.dir },
			env(ingest.endpoint),
		);
		expect(result).toMatchObject({ code: 0, stdout: "" });
		expect(result.stderr).toBe(
			"harnessforce: session registration failed (TimeoutError)\n",
		);
		expect(result.elapsedMs).toBeLessThan(4000);
	}, 10_000);

	it("exits 0 silently outside a git repository", async () => {
		const ingest = await startIngest("accept");
		const result = await runBundle(
			"session-start",
			{ session_id: "s-1", cwd: mkdtempSync(join(tmpdir(), "hf-plain-")) },
			env(ingest.endpoint),
		);
		expect(result).toMatchObject({ code: 0, stdout: "", stderr: "" });
		expect(ingest.received).toEqual([]);
	});

	it("exits 0 on unreadable input", async () => {
		const child = spawn(process.execPath, [hookScript, "session-start"]);
		child.stdin.end("not json");
		const code = await new Promise((resolve) => child.on("close", resolve));
		expect(code).toBe(0);
	});
});
