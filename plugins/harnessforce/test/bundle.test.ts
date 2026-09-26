import { execFileSync, spawn } from "node:child_process";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	managedDirFor,
	readManagedEnv,
} from "../../../packages/cli/src/managed.js";
import { tempDir } from "./support.js";

// turboはtestの前にこのpackageのbuildを実行する。直接vitestを実行する場合は先に`pnpm build`する。
const built = fileURLToPath(new URL("../dist/marketplace", import.meta.url));
// buildの出力をnode_modulesの無い場所へ写し、bundleが依存packageを実行時に解決しないことも確かめる。
let marketplace: string;
let hookScript: string;
beforeAll(() => {
	marketplace = join(mkdtempSync(join(tmpdir(), "hf-marketplace-")), "out");
	cpSync(built, marketplace, { recursive: true });
	afterAll(() =>
		rmSync(dirname(marketplace), { recursive: true, force: true }),
	);
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
	const dir = realpathSync(tempDir("hf-repo-"));
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

// homeは空の一時directoryを既定とし、testを実行する利用者の~/.claudeを読まない。
function runBundle(
	event: string,
	input: object,
	env: Record<string, string>,
	home = tempDir("hf-home-"),
) {
	return new Promise<{
		code: number | null;
		stdout: string;
		stderr: string;
		elapsedMs: number;
	}>((resolve) => {
		const began = Date.now();
		const child = spawn(process.execPath, [hookScript, event], {
			env: {
				PATH: process.env.PATH ?? "",
				HOME: home,
				USERPROFILE: home,
				...env,
			},
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

// `hf otel-headers`の代わりのscript。keychainには触れず、固定のkeyを返す。
function hfReturning(key: string): string {
	const dir = tempDir("hf-bin-");
	const hf = join(dir, "hf");
	writeFileSync(
		hf,
		`#!/bin/sh\n[ "$1" = otel-headers ] && printf '{"Authorization":"Bearer ${key}"}'\n`,
	);
	chmodSync(hf, 0o755);
	return dir;
}

// managed settingsのdirectoryは端末の実pathでbundleからは差し替えられないため、利用者用のkeyの経路で送る。
// Workspace用のkeyの選び方はunit testで確かめる。
const env = (endpoint: string) => ({
	HARNESSFORCE_ENDPOINT: endpoint,
	HARNESSFORCE_WORKSPACE_ID: "ws1",
	PATH: `${hfReturning("hf_ik_ws1_secret")}:${process.env.PATH ?? ""}`,
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

// bundleは端末の実際のmanaged settingsを読む。Workspace用のkeyを配られた端末では、testの送信がそのkeyで本番の送信先へ届くため実行しない。
const { HARNESSFORCE_INGEST_KEY: realManagedKey } = await readManagedEnv(
	managedDirFor(process.platform),
	["HARNESSFORCE_INGEST_KEY"],
);

describe.skipIf(process.platform === "win32" || realManagedKey !== undefined)(
	"bundled hook",
	() => {
		it("registers a real git repository and its first prompt through HTTP", async () => {
			const repo = makeRepo();
			const ingest = await startIngest("accept");
			const pad = tempDir("hf-scratch-");
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
				systemMessage: "送信キーが失効しています。`hf init`を実行してください",
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
			expect(result.elapsedMs).toBeGreaterThanOrEqual(1900);
			expect(result.elapsedMs).toBeLessThan(4000);
		}, 10_000);

		// `hf otel-headers`の代わりのscript。keychainには触れない。
		function fakeHfOnPath(): string {
			const dir = tempDir("hf-bin-");
			const hf = join(dir, "hf");
			writeFileSync(
				hf,
				`#!/bin/sh\n[ "$1" = otel-headers ] && printf '{"Authorization":"Bearer hf_ik_%s_user"}' "$HARNESSFORCE_WORKSPACE_ID"\n`,
			);
			chmodSync(hf, 0o755);
			return dir;
		}

		it.skipIf(process.platform === "win32")(
			"sends with the user key from hf on PATH and claims source=cli",
			async () => {
				const repo = makeRepo();
				const ingest = await startIngest("accept");
				const result = await runBundle(
					"session-start",
					{ session_id: "s-1", cwd: repo.dir, source: "startup" },
					{
						HARNESSFORCE_ENDPOINT: ingest.endpoint,
						HARNESSFORCE_WORKSPACE_ID: "ws1",
						HARNESSFORCE_ISSUE: "ENG-42",
						PATH: `${fakeHfOnPath()}:${process.env.PATH ?? ""}`,
					},
				);
				expect(result).toMatchObject({ code: 0, stdout: "", stderr: "" });
				expect(ingest.received[0]?.headers.authorization).toBe(
					"Bearer hf_ik_ws1_user",
				);
				expect(ingest.received[0]?.body).toEqual([
					expect.objectContaining({
						source: "cli",
						issue_identifier: "ENG-42",
					}),
				]);
			},
		);

		// hf initが固定した送信先の代わりに、testのingestのoriginだけへkeyを出すhf。
		function pinnedHfOnPath(pinnedOrigin: string): string {
			const dir = tempDir("hf-bin-");
			const hf = join(dir, "hf");
			writeFileSync(
				hf,
				`#!/bin/sh\ncase "$HARNESSFORCE_ENDPOINT" in\n  ${pinnedOrigin}/*) printf '{"Authorization":"Bearer hf_ik_ws1_user"}' ;;\n  *) echo "harnessforce: user key withheld (destination not verified)" >&2; exit 1 ;;\nesac\n`,
			);
			chmodSync(hf, 0o755);
			return dir;
		}

		it.skipIf(process.platform === "win32")(
			"passes its destination to hf and sends nothing when hf withholds the key",
			async () => {
				const repo = makeRepo();
				const ingest = await startIngest("accept");
				const env = {
					HARNESSFORCE_WORKSPACE_ID: "ws1",
					PATH: `${pinnedHfOnPath("https://pinned.example.test")}:${process.env.PATH ?? ""}`,
				};
				const withheld = await runBundle(
					"session-start",
					{ session_id: "s-1", cwd: repo.dir, source: "startup" },
					{ ...env, HARNESSFORCE_ENDPOINT: ingest.endpoint },
				);
				expect(withheld).toMatchObject({ code: 0, stdout: "" });
				expect(withheld.stderr).toBe(
					"harnessforce: no user key in keychain or read failed\n" +
						"harnessforce: session registration skipped (no ingest key)\n",
				);
				expect(ingest.received).toEqual([]);
			},
		);

		// correlation.md「Node.jsの実行時の変数」: 取り除いて起動し直してから送る。hfへも渡さない。
		it.skipIf(process.platform === "win32")(
			"relaunches without Node runtime variables and sends directly",
			async () => {
				const repo = makeRepo();
				const ingest = await startIngest("accept");
				const proxied: string[] = [];
				const proxy = createServer((req, res) => {
					proxied.push(`${req.method} ${req.url}`);
					res.writeHead(502).end();
				});
				proxy.on("connect", (req, socket) => {
					proxied.push(`CONNECT ${req.url}`);
					socket.destroy();
				});
				await new Promise<void>((resolve) =>
					proxy.listen(0, "127.0.0.1", resolve),
				);
				cleanups.push(() => {
					proxy.closeAllConnections();
					proxy.close();
				});
				const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
				const hfDir = tempDir("hf-bin-");
				const envOut = join(hfDir, "env.txt");
				writeFileSync(
					join(hfDir, "hf"),
					`#!/bin/sh\nenv > "${envOut}"\nprintf '{"Authorization":"Bearer hf_ik_ws1_user"}'\n`,
				);
				chmodSync(join(hfDir, "hf"), 0o755);
				const runtime = {
					NODE_TLS_REJECT_UNAUTHORIZED: "0",
					NODE_OPTIONS: "--no-deprecation",
					NODE_USE_ENV_PROXY: "1",
					HTTP_PROXY: proxyUrl,
					http_proxy: proxyUrl,
					HTTPS_PROXY: proxyUrl,
					NO_PROXY: "",
					OPENSSL_CONF: "",
					SSL_CERT_FILE: "/nonexistent.pem",
				};
				const result = await runBundle(
					"session-start",
					{ session_id: "s-1", cwd: repo.dir, source: "startup" },
					{
						...runtime,
						HARNESSFORCE_ENDPOINT: ingest.endpoint,
						HARNESSFORCE_WORKSPACE_ID: "ws1",
						PATH: `${hfDir}:${process.env.PATH ?? ""}`,
					},
				);
				expect(result).toMatchObject({ code: 0, stdout: "" });
				expect(result.stderr).not.toContain("harnessforce:");
				expect(proxied).toEqual([]);
				expect(ingest.received.map((r) => r.headers.authorization)).toEqual([
					"Bearer hf_ik_ws1_user",
				]);
				const hfEnv = readFileSync(envOut, "utf8");
				for (const name of Object.keys(runtime).filter(
					(n) => n !== "NODE_USE_ENV_PROXY",
				))
					expect(hfEnv).not.toMatch(new RegExp(`^${name}=`, "m"));
				expect(hfEnv).not.toMatch(/^HARNESSFORCE_RUNTIME_ENV=/m);
			},
			10_000,
		);

		it("exits 0 silently outside a git repository", async () => {
			const ingest = await startIngest("accept");
			const result = await runBundle(
				"session-start",
				{ session_id: "s-1", cwd: tempDir("hf-plain-") },
				env(ingest.endpoint),
			);
			expect(result).toMatchObject({ code: 0, stdout: "", stderr: "" });
			expect(ingest.received).toEqual([]);
		});

		it("sends a config snapshot of the real home and repository through HTTP", async () => {
			const repo = makeRepo();
			writeFileSync(join(repo.dir, "CLAUDE.md"), "Secret team notes\n");
			const home = tempDir("hf-home-");
			mkdirSync(join(home, ".claude/skills/ship"), { recursive: true });
			writeFileSync(join(home, ".claude/skills/ship/SKILL.md"), "ship it\n");
			const ingest = await startIngest("accept");
			const result = await runBundle(
				"session-start",
				{ session_id: "s-1", cwd: repo.dir, source: "startup" },
				env(ingest.endpoint),
				home,
			);
			expect(result).toMatchObject({ code: 0, stdout: "" });
			const snapshot = ingest.received.find((r) =>
				r.url?.endsWith("/v1/config-snapshots"),
			);
			expect(snapshot?.url).toBe("/base/v1/config-snapshots");
			// managedのdirectoryはtestを実行する端末の実pathなので、比較から外す。
			const [item] = snapshot?.body as {
				components: { source: string }[];
			}[];
			expect([
				{
					...item,
					components: item?.components.filter((c) => c.source !== "managed"),
				},
			]).toEqual([
				{
					agent: "claude_code",
					session_id: "s-1",
					components: [
						expect.objectContaining({
							kind: "rule",
							source: "repository",
							id: "CLAUDE.md",
						}),
						expect.objectContaining({
							kind: "skill",
							source: "user",
							id: "ship",
						}),
					],
				},
			]);
			expect(JSON.stringify(snapshot?.body)).not.toContain("Secret team notes");
		});

		it("sends only the config snapshot outside a git repository", async () => {
			const cwd = realpathSync(tempDir("hf-plain-"));
			writeFileSync(join(cwd, "CLAUDE.md"), "plain\n");
			const ingest = await startIngest("accept");
			const result = await runBundle(
				"session-start",
				{ session_id: "s-1", cwd, source: "startup" },
				env(ingest.endpoint),
			);
			expect(result).toMatchObject({ code: 0, stdout: "" });
			expect(ingest.received.map((r) => r.url)).toEqual([
				"/base/v1/config-snapshots",
			]);
		});

		it("exits 0 on unreadable input", async () => {
			const child = spawn(process.execPath, [hookScript, "session-start"]);
			child.stdin.end("not json");
			const code = await new Promise((resolve) => child.on("close", resolve));
			expect(code).toBe(0);
		});
	},
);
