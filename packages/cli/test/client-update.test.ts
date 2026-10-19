import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { describe, expect, it, vi } from "vitest";
import {
	ingestKeyAccount,
	ingestOriginAccount,
} from "../src/credentials/keychain.js";
import { fakeKeychain, runCli } from "./support/cli.js";

// client-updates.md「clientの扱い」のCLIの側。

const pkg = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };
const WORKSPACE = "019f0000-0000-7000-8000-000000000001";
const ENDPOINT = "https://ingest.example.test/base";
const KEY = "hf_ik_secretkeyvalue";
const NOW = new Date("2026-11-01T12:00:00Z");
const UNSUPPORTED_LINE =
	"This Harnessforce CLI version is no longer supported, so nothing is being sent to Harnessforce. Update it: `npm install -g @harnessforce/cli@latest`";
const OUTDATED_LINE =
	"Harnessforce CLI 9.9.9 is available. Update it: `npm install -g @harnessforce/cli@latest`";

type State = Record<string, unknown>;

function home(state?: State) {
	const dir = tempDir("hf-client-update-");
	mkdirSync(join(dir, ".claude"), { recursive: true });
	writeFileSync(
		join(dir, ".claude", "settings.json"),
		JSON.stringify({
			env: {
				HARNESSFORCE_WORKSPACE_ID: WORKSPACE,
				HARNESSFORCE_ENDPOINT: ENDPOINT,
			},
		}),
	);
	if (state) {
		mkdirSync(join(dir, ".harnessforce"), { recursive: true });
		writeFileSync(
			join(dir, ".harnessforce", "update-status.json"),
			JSON.stringify({ version: pkg.version, ...state }),
		);
	}
	return dir;
}

const readState = (dir: string) =>
	JSON.parse(
		readFileSync(join(dir, ".harnessforce", "update-status.json"), "utf8"),
	) as State;

const unsupported = (receivedAt = NOW.toISOString()) => ({
	status: "unsupported",
	reason: "security",
	receivedAt,
});

const keychain = () =>
	fakeKeychain({
		items: {
			[ingestKeyAccount(WORKSPACE)]: KEY,
			[ingestOriginAccount(WORKSPACE)]: "https://ingest.example.test",
		},
	}).keychain;

const gitRepo = async (cwd: string, args: readonly string[]) => {
	if (cwd !== "/work/web") return undefined;
	if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree")
		return "true";
	if (args[0] === "rev-parse") return "a".repeat(40);
	if (args[0] === "remote" && args.length === 1) return "origin";
	if (args[0] === "remote") return "git@github.com:Acme/Web.git";
	if (args[0] === "symbolic-ref") return "feature/ENG-42";
	return undefined;
};

// Codexのhook。資格情報を伴う送信と、登録を送るsourceでの表示を確かめる。
const hookRun = (
	dir: string,
	fetch: (url: URL, init: RequestInit) => Promise<Response>,
) =>
	runCli(["hook", "session-start"], {
		homeDir: dir,
		env: {
			HARNESSFORCE_WORKSPACE_ID: WORKSPACE,
			HARNESSFORCE_ENDPOINT: ENDPOINT,
		},
		keychain: keychain(),
		now: () => NOW,
		hookGit: gitRepo as never,
		readStdin: async () =>
			Buffer.from(
				JSON.stringify({
					session_id: "sess-1",
					cwd: "/work/web",
					source: "startup",
				}),
			),
		fetch,
	});

const systemMessageOf = (out: string) =>
	(JSON.parse(out) as { systemMessage?: string }).systemMessage;

describe("sending commands while the CLI version is unsupported", () => {
	it.each([[["import"]], [["usage-limits", "status"]], [["init"]]])(
		"%j sends nothing, prints the update line and exits 1",
		async (argv) => {
			const fetch = vi.fn();
			const result = await runCli(argv, {
				homeDir: home(unsupported()),
				now: () => NOW,
				fetch,
			});
			expect(result).toEqual({
				code: 1,
				out: "",
				err: `${UNSUPPORTED_LINE}\n`,
			});
			expect(fetch).not.toHaveBeenCalled();
		},
	);

	it("launches the agent without the Harnessforce environment for harnessforce run", async () => {
		const launch = vi.fn(async () => ({ kind: "exited" as const, code: 7 }));
		const result = await runCli(
			["run", "--issue", "ENG-1", "--", "claude", "--resume"],
			{
				homeDir: home(unsupported()),
				env: { PATH: "/usr/bin" },
				restoredEnv: { NODE_OPTIONS: "--max-old-space-size=4096" },
				now: () => NOW,
				launch,
			},
		);
		expect(result).toEqual({ code: 7, out: "", err: `${UNSUPPORTED_LINE}\n` });
		expect(launch).toHaveBeenCalledWith({
			command: "claude",
			args: ["--resume"],
			env: { PATH: "/usr/bin", NODE_OPTIONS: "--max-old-space-size=4096" },
		});
	});

	it("rechecks without credentials after 24 hours and sends again when current", async () => {
		const dir = home(unsupported("2026-10-31T00:00:00.000Z"));
		// statusLineの送信の子processは確かめ直さず、何も送らずに終える。
		const childFetch = vi.fn();
		expect(
			await runCli(["usage-limits", "send", "{}"], {
				homeDir: dir,
				now: () => NOW,
				fetch: childFetch,
			}),
		).toEqual({ code: 0, out: "", err: "" });
		expect(childFetch).not.toHaveBeenCalled();

		const calls: { url: string; init: RequestInit }[] = [];
		await hookRun(dir, async (url, init) => {
			calls.push({ url: String(url), init });
			return new Response(null, {
				status: 204,
				headers: { "harnessforce-client-update": "status=current" },
			});
		});
		expect(calls.map((call) => call.url)).toEqual([
			`${ENDPOINT}/v1/client-status`,
			`${ENDPOINT}/v1/sessions`,
		]);
		expect(calls[0]?.init.method).toBe("GET");
		expect(calls[0]?.init.headers).toEqual({
			"user-agent": `harnessforce-cli/${pkg.version}`,
		});
		expect(readState(dir).status).toBe("current");
	});

	it("registers nothing from the Codex hook and shows the update line", async () => {
		const fetch = vi.fn();
		const result = await hookRun(home(unsupported()), fetch);
		expect(fetch).not.toHaveBeenCalled();
		expect(result.code).toBe(0);
		expect(systemMessageOf(result.out)).toBe(UNSUPPORTED_LINE);
	});
});

describe("harnessforce otel-headers", () => {
	it("prints no key and exits 5 while the CLI version is unsupported", async () => {
		const result = await runCli(["otel-headers"], {
			homeDir: home(unsupported()),
			env: { HARNESSFORCE_WORKSPACE_ID: WORKSPACE },
			keychain: keychain(),
		});
		expect(result).toEqual({ code: 5, out: "", err: "" });
	});

	it("ignores a state saved by another version", async () => {
		const dir = home();
		mkdirSync(join(dir, ".harnessforce"), { recursive: true });
		writeFileSync(
			join(dir, ".harnessforce", "update-status.json"),
			JSON.stringify({ version: "0.0.1", ...unsupported() }),
		);
		const result = await runCli(["otel-headers"], {
			homeDir: dir,
			env: { HARNESSFORCE_WORKSPACE_ID: WORKSPACE },
			keychain: keychain(),
		});
		expect(result.code).not.toBe(5);
	});
});

describe("update notices after a command", () => {
	it("shows outdated at most once a day and remembers when", async () => {
		const dir = home({
			status: "outdated",
			latest: "9.9.9",
			receivedAt: NOW.toISOString(),
		});
		const first = await runCli(["import"], {
			homeDir: dir,
			now: () => NOW,
			fetch: async () => new Response(null, { status: 500 }),
		});
		expect(first.err.endsWith(`${OUTDATED_LINE}\n`)).toBe(true);
		expect(readState(dir).outdatedShownAt).toBe(NOW.toISOString());
		const second = await runCli(["import"], {
			homeDir: dir,
			now: () => new Date(NOW.getTime() + 60_000),
			fetch: async () => new Response(null, { status: 500 }),
		});
		expect(second.err).not.toContain(OUTDATED_LINE);
	});

	it("does not show outdated with NO_UPDATE_NOTIFIER", async () => {
		const result = await runCli(["import"], {
			homeDir: home({
				status: "outdated",
				latest: "9.9.9",
				receivedAt: NOW.toISOString(),
			}),
			env: { NO_UPDATE_NOTIFIER: "1" },
			now: () => NOW,
			fetch: async () => new Response(null, { status: 500 }),
		});
		expect(result.err).not.toContain(OUTDATED_LINE);
	});

	it("declares the version on requests and saves the update status from the response", async () => {
		const dir = home();
		const fetch = vi.fn(
			async () =>
				new Response(null, {
					status: 202,
					headers: {
						"harnessforce-client-update":
							'status=deprecated, latest="9.9.9", reason=security, deadline=@1794268800',
					},
				}),
		);
		const result = await hookRun(dir, fetch);
		const init = (fetch.mock.calls as unknown as [URL, RequestInit][])[0]?.[1];
		expect((init?.headers as Record<string, string>)["user-agent"]).toBe(
			`harnessforce-cli/${pkg.version}`,
		);
		expect(readState(dir)).toMatchObject({
			status: "deprecated",
			deadline: "2026-11-10T00:00:00.000Z",
		});
		expect(systemMessageOf(result.out)).toBe(
			"A security update for Harnessforce CLI is available. This version stops sending on 2026-11-10 (00:00 UTC). Update it: `npm install -g @harnessforce/cli@latest`",
		);
	});
});
