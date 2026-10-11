import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { describe, expect, it } from "vitest";
import {
	ingestKeyAccount,
	ingestOriginAccount,
} from "../../src/credentials/keychain.js";
import { fakeKeychain, runCli } from "../support/cli.js";

const WORKSPACE = "019f0000-0000-7000-8000-000000000001";
const ENDPOINT = "https://ingest.example.test/base";
const KEY = "hf_ik_secretkeyvalue";
const SUMMARY = {
	agent: "claude_code",
	observed_at: "2026-10-10T05:30:00Z",
	windows: [
		{
			window_minutes: 300,
			used_percent: 42,
			resets_at: "2026-10-10T08:00:00Z",
		},
	],
};

type Sent = { url: string; authorization: string; body: unknown };

function setup(
	options: {
		keychain?: Parameters<typeof fakeKeychain>[0];
		status?: number;
		fetchFails?: boolean;
		userSettingsEnv?: Record<string, string>;
		mark?: false | { consented: boolean; text_version: number; original: null };
	} = {},
) {
	const home = tempDir("hf-usage-send-");
	if (options.mark !== false) {
		mkdirSync(join(home, ".harnessforce"), { recursive: true });
		writeFileSync(
			join(home, ".harnessforce", "usage-limits.json"),
			JSON.stringify(
				options.mark ?? { consented: true, text_version: 1, original: null },
			),
		);
	}
	mkdirSync(join(home, ".claude"), { recursive: true });
	writeFileSync(
		join(home, ".claude", "settings.json"),
		JSON.stringify({
			env: options.userSettingsEnv ?? {
				HARNESSFORCE_WORKSPACE_ID: WORKSPACE,
				HARNESSFORCE_ENDPOINT: ENDPOINT,
			},
		}),
	);
	const { keychain } = fakeKeychain(
		options.keychain ?? {
			items: {
				[ingestKeyAccount(WORKSPACE)]: KEY,
				[ingestOriginAccount(WORKSPACE)]: "https://ingest.example.test",
			},
		},
	);
	const sent: Sent[] = [];
	const run = (payload: string = JSON.stringify(SUMMARY)) =>
		runCli(["usage-limits", "send", payload], {
			homeDir: home,
			keychain,
			fetch: async (url, init) => {
				if (options.fetchFails) throw new Error("network down");
				sent.push({
					url: String(url),
					authorization: (init?.headers as Record<string, string>)
						.authorization as string,
					body: JSON.parse(String(init?.body)),
				});
				return new Response(null, { status: options.status ?? 200 });
			},
		});
	return { run, sent };
}

describe("harnessforce usage-limits send", () => {
	it("posts the summary to /v1/usage-limits with the user ingest key", async () => {
		const { run, sent } = setup();
		expect(await run()).toEqual({ code: 0, out: "", err: "" });
		expect(sent).toEqual([
			{
				url: `${ENDPOINT}/v1/usage-limits`,
				authorization: `Bearer ${KEY}`,
				body: [SUMMARY],
			},
		]);
	});

	it.each([
		["a failed send", { fetchFails: true }],
		["a rejected key", { status: 401 }],
		["a server error", { status: 500 }],
	])("prints nothing and exits 0 on %s", async (_name, options) => {
		const { run } = setup(options);
		expect(await run()).toEqual({ code: 0, out: "", err: "" });
	});

	it.each([
		["no usage-limits.json", { mark: false as const }],
		[
			"a revoked consent",
			{ mark: { consented: false, text_version: 1, original: null } },
		],
		[
			"a consent for an old text",
			{ mark: { consented: true, text_version: 0, original: null } },
		],
	])("sends nothing with %s", async (_name, options) => {
		const { run, sent } = setup(options);
		expect(await run()).toEqual({ code: 0, out: "", err: "" });
		expect(sent).toEqual([]);
	});

	it("sends nothing without a user ingest key in the keychain", async () => {
		const { run, sent } = setup({ keychain: { items: {} } });
		expect(await run()).toEqual({ code: 0, out: "", err: "" });
		expect(sent).toEqual([]);
	});

	it("sends nothing to an endpoint that harnessforce init did not pin", async () => {
		const { run, sent } = setup({
			keychain: {
				items: {
					[ingestKeyAccount(WORKSPACE)]: KEY,
					[ingestOriginAccount(WORKSPACE)]: "https://other.example.test",
				},
			},
		});
		expect(await run()).toEqual({ code: 0, out: "", err: "" });
		expect(sent).toEqual([]);
	});

	it.each([
		["not JSON", "{"],
		["another agent", JSON.stringify({ ...SUMMARY, agent: "codex" })],
		["no window", JSON.stringify({ ...SUMMARY, windows: [] })],
		[
			"a percentage above 100",
			JSON.stringify({
				...SUMMARY,
				windows: [{ ...SUMMARY.windows[0], used_percent: 101 }],
			}),
		],
		[
			"an unknown window",
			JSON.stringify({
				...SUMMARY,
				windows: [{ ...SUMMARY.windows[0], window_minutes: 60 }],
			}),
		],
	])("sends nothing for a payload that is %s", async (_name, payload) => {
		const { run, sent } = setup();
		expect(await run(payload)).toEqual({ code: 0, out: "", err: "" });
		expect(sent).toEqual([]);
	});

	it("drops extra fields of a window", async () => {
		const { run, sent } = setup();
		await run(
			JSON.stringify({
				...SUMMARY,
				windows: [{ ...SUMMARY.windows[0], cwd: "/secret" }],
			}),
		);
		expect(JSON.stringify(sent[0]?.body)).not.toContain("/secret");
		expect(sent).toHaveLength(1);
	});

	it("shows the usage for the wrong arguments", async () => {
		const result = await runCli(["usage-limits"]);
		expect(result.code).toBe(1);
		expect(result.err).toContain("usage-limits statusline");
	});
});
