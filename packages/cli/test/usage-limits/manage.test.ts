import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { storedToken } from "@harnessforce/test-support/api-token";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { describe, expect, it } from "vitest";
import { fakeKeychain, runCli } from "../support/cli.js";

const WORKSPACE = "ws1";
const APP = "https://app.example.test";
const CONSENT_URL = `${APP}/api/v1/cli/usage-limits/consent`;
const FAR = "2099-01-01T00:00:00Z";
// docs/references/claude-hud-statusline.md が記録する、claude-hudが書いたstatusLineの形。
const HUD = {
	type: "command",
	// biome-ignore lint/suspicious/noTemplateCurlyInString: shellの展開記号。claude-hudのcommandを写す。
	command:
		"bash -c 'cols=${COLUMNS:-}; exec node \"${plugin_dir}dist/index.js\"'",
	refreshInterval: 5,
};
const OURS = "harnessforce usage-limits statusline";

// directoryの権限で書き込みを止められるのは、Windowsとroot以外。そこでは置き換えの失敗を作れない。
const canBlockWrites = process.platform !== "win32" && process.getuid?.() !== 0;

type Reply = { status: number; body?: unknown };
type Options = {
	settings?: unknown;
	rawSettings?: string;
	answers?: string[];
	replies?: Partial<Record<"GET" | "PUT" | "DELETE", Reply[]>>;
	keychain?: Parameters<typeof fakeKeychain>[0];
	platform?: NodeJS.Platform;
	env?: Record<string, string>;
	mark?: unknown;
};

function setup(options: Options = {}) {
	const home = tempDir("hf-ul-manage-");
	mkdirSync(join(home, ".claude"), { recursive: true });
	const base = {
		env: {
			HARNESSFORCE_WORKSPACE_ID: WORKSPACE,
			HARNESSFORCE_ENDPOINT: "https://ingest.example.test/base",
		},
	};
	const settingsPath = join(home, ".claude", "settings.json");
	writeFileSync(
		settingsPath,
		options.rawSettings ??
			JSON.stringify({ ...base, ...(options.settings as object) }),
	);
	if (options.mark !== undefined) {
		mkdirSync(join(home, ".harnessforce"), { recursive: true });
		writeFileSync(
			join(home, ".harnessforce", "usage-limits.json"),
			JSON.stringify(options.mark),
		);
	}
	const { keychain } = fakeKeychain(
		options.keychain ?? {
			items: {
				[`${WORKSPACE}:ingest-key`]: "hf_ik_user",
				[`${WORKSPACE}:ingest-origin`]: "https://ingest.example.test",
				[`${WORKSPACE}:url-origin`]: APP,
				[`${WORKSPACE}:api-token`]: storedToken(WORKSPACE, "current", {
					accessToken: FAR,
					refreshToken: FAR,
				}),
			},
		},
	);
	const calls: { method: string; body: unknown }[] = [];
	const questions: string[] = [];
	const answers = [...(options.answers ?? ["y"])];
	const replies = {
		GET: [
			{
				status: 200,
				body: {
					workspace_opted_in: true,
					shared: false,
					current_text_version: 1,
				},
			},
		],
		PUT: [{ status: 204 }],
		DELETE: [{ status: 204 }],
		...options.replies,
	};
	const run = (args: string[]) =>
		runCli(["usage-limits", ...args], {
			homeDir: home,
			keychain,
			platform: options.platform ?? "linux",
			// settingsが読めない端末でも宛先を解決できるよう、shellの環境にも持たせる。
			env: { ...base.env, ...options.env },
			ask: async (question) => {
				questions.push(question);
				return answers.shift() ?? "";
			},
			fetch: async (url, init) => {
				if (String(url) !== CONSENT_URL)
					return new Response(null, { status: 404 });
				const method = (init?.method ?? "GET") as "GET" | "PUT" | "DELETE";
				calls.push({
					method,
					body: init?.body ? JSON.parse(String(init.body)) : undefined,
				});
				const queue = replies[method] ?? [];
				const reply = queue.length > 1 ? queue.shift() : queue[0];
				return new Response(
					reply?.body === undefined ? null : JSON.stringify(reply.body),
					{
						status: reply?.status ?? 500,
						headers: { "content-type": "application/json" },
					},
				);
			},
		});
	const readSettings = () => JSON.parse(readFileSync(settingsPath, "utf8"));
	const markPath = join(home, ".harnessforce", "usage-limits.json");
	const readMark = () =>
		existsSync(markPath)
			? JSON.parse(readFileSync(markPath, "utf8"))
			: undefined;
	return { run, calls, questions, readSettings, readMark, home, settingsPath };
}

describe("harnessforce usage-limits on", () => {
	it("adds the statusLine when there is none, and off removes it again", async () => {
		const t = setup();
		const result = await t.run(["on"]);
		expect(result.code).toBe(0);
		expect(t.readSettings().statusLine).toEqual({
			type: "command",
			command: OURS,
		});
		expect(t.readMark()).toEqual({
			consented: true,
			text_version: 1,
			original: null,
		});
		expect(t.calls).toEqual([
			{ method: "GET", body: undefined },
			{ method: "PUT", body: { text_version: 1 } },
		]);
		const off = await t.run(["off"]);
		expect(off.code).toBe(0);
		expect(t.readSettings().statusLine).toBeUndefined();
		expect(t.readMark()).toBeUndefined();
		expect(t.calls.at(-1)?.method).toBe("DELETE");
	});

	it("wraps the claude-hud statusLine changing only its command, and off restores it", async () => {
		const t = setup({ settings: { statusLine: HUD, theme: "dark" } });
		expect((await t.run(["on"])).code).toBe(0);
		expect(t.readSettings().statusLine).toEqual({
			type: "command",
			command: OURS,
			refreshInterval: 5,
		});
		expect(t.readSettings().theme).toBe("dark");
		expect(t.readMark()?.original).toEqual(HUD);
		expect((await t.run(["off"])).code).toBe(0);
		expect(t.readSettings().statusLine).toEqual(HUD);
		expect(t.readMark()).toBeUndefined();
	});

	it("shows the consent text and asks first, and a Japanese environment gets the Japanese text", async () => {
		const t = setup({ env: { LANG: "ja_JP.UTF-8" } });
		const result = await t.run(["on"]);
		expect(result.out).toContain("このWorkspaceのメンバー全員が見られます");
		expect(t.questions).toHaveLength(1);
		const en = await setup().run(["on"]);
		expect(en.out).toContain("Everyone in this workspace can see");
	});

	it("changes nothing when the answer is not y", async () => {
		const t = setup({ answers: ["n"], settings: { statusLine: HUD } });
		const result = await t.run(["on"]);
		expect(result.code).toBe(1);
		expect(t.readSettings().statusLine).toEqual(HUD);
		expect(t.readMark()).toBeUndefined();
		expect(t.calls.some((c) => c.method === "PUT")).toBe(false);
	});

	it("skips the question with --yes", async () => {
		const t = setup({ answers: [] });
		expect((await t.run(["on", "--yes"])).code).toBe(0);
		expect(t.questions).toEqual([]);
	});

	it("keeps the first original when run twice", async () => {
		const t = setup({ settings: { statusLine: HUD } });
		await t.run(["on", "--yes"]);
		const before = readFileSync(t.settingsPath, "utf8");
		expect((await t.run(["on", "--yes"])).code).toBe(0);
		expect(readFileSync(t.settingsPath, "utf8")).toBe(before);
		expect(t.readMark()?.original).toEqual(HUD);
	});

	it("saves a null original when the command is ours but there is no record", async () => {
		const t = setup({
			settings: { statusLine: { type: "command", command: OURS } },
		});
		await t.run(["on", "--yes"]);
		expect(t.readMark()?.original).toBeNull();
	});

	it("says the values are not stored until the Workspace opts in", async () => {
		const t = setup({
			replies: {
				GET: [
					{
						status: 200,
						body: {
							workspace_opted_in: false,
							shared: false,
							current_text_version: 1,
						},
					},
				],
			},
		});
		const result = await t.run(["on", "--yes"]);
		expect(result.code).toBe(0);
		expect(result.out).toContain("opt-inするまで");
	});

	it("goes on when the opt-in state cannot be read", async () => {
		const t = setup({ replies: { GET: [{ status: 500 }] } });
		expect((await t.run(["on", "--yes"])).code).toBe(0);
	});

	it("does nothing on Windows", async () => {
		const t = setup({ platform: "win32" });
		const result = await t.run(["on", "--yes"]);
		expect(result.code).toBe(1);
		expect(result.err).toContain("Windows");
		expect(result.out).toBe("");
		expect(t.calls).toEqual([]);
	});

	it("does nothing without a user ingest key", async () => {
		const t = setup({ keychain: { items: {} } });
		const result = await t.run(["on", "--yes"]);
		expect(result.code).toBe(1);
		expect(result.err).toContain("利用者用の送信キー");
		expect(t.readSettings().statusLine).toBeUndefined();
	});

	it.each([
		["unreadable settings", { rawSettings: "{" }, "読めません"],
		[
			"a statusLine that is not a command",
			{ settings: { statusLine: { type: "text" } } },
			"組み込めません",
		],
		[
			"a statusLine that is not an object",
			{ settings: { statusLine: "x" } },
			"組み込めません",
		],
	])("records no consent for %s", async (_name, options, message) => {
		const t = setup(options as Options);
		const result = await t.run(["on", "--yes"]);
		expect(result.code).toBe(1);
		expect(result.err).toContain(message);
		expect(t.calls.some((c) => c.method === "PUT")).toBe(false);
		expect(t.readMark()).toBeUndefined();
	});

	it.each([
		[
			"a text version that is not current",
			400,
			{ code: "invalid_text_version" },
			"更新",
		],
		["a viewer", 403, { code: "forbidden" }, "閲覧のみのロール"],
		[
			"a read-only Workspace",
			403,
			{ code: "workspace_read_only" },
			"閲覧のみのため",
		],
		["an expired login", 401, undefined, "有効期限"],
		["a server error", 500, undefined, "通信に失敗"],
	])("stops without changes for %s", async (_name, status, body, message) => {
		const t = setup({
			settings: { statusLine: HUD },
			replies: { PUT: [{ status, body }] },
		});
		const result = await t.run(["on", "--yes"]);
		expect(result.code).toBe(1);
		expect(result.err).toContain(message);
		expect(t.readSettings().statusLine).toEqual(HUD);
		expect(t.readMark()).toBeUndefined();
	});

	it("withdraws the consent and leaves the settings alone when the mark cannot be written", async () => {
		const t = setup({ settings: { statusLine: HUD } });
		// 印の場所をdirectoryにして、置き換えを失敗させる。
		mkdirSync(join(t.home, ".harnessforce", "usage-limits.json"), {
			recursive: true,
		});
		const result = await t.run(["on", "--yes"]);
		expect(result.code).toBe(1);
		expect(t.readSettings().statusLine).toEqual(HUD);
		expect(t.calls.at(-1)?.method).toBe("DELETE");
	});

	it.skipIf(!canBlockWrites)(
		"removes the mark and withdraws the consent when the settings cannot be written",
		async () => {
			const t = setup({ settings: { statusLine: HUD } });
			// 読んだ後に置き換えだけ失敗させるため、親directoryを書けなくする。rootは権限に関係なく書けるので検証しない。
			const { chmodSync } = await import("node:fs");
			chmodSync(join(t.home, ".claude"), 0o500);
			try {
				const result = await t.run(["on", "--yes"]);
				expect(result.code).toBe(1);
				expect(t.readMark()).toBeUndefined();
				expect(t.calls.at(-1)?.method).toBe("DELETE");
			} finally {
				chmodSync(join(t.home, ".claude"), 0o700);
			}
		},
	);

	it.skipIf(!canBlockWrites)(
		"keeps the saved original when a second run fails to write the settings",
		async () => {
			const t = setup({
				settings: { statusLine: { type: "command", command: OURS } },
				mark: { consented: true, text_version: 1, original: HUD },
			});
			const { chmodSync } = await import("node:fs");
			chmodSync(join(t.home, ".claude"), 0o500);
			try {
				expect((await t.run(["on", "--yes"])).code).toBe(1);
				expect(t.readMark()).toEqual({
					consented: false,
					text_version: 1,
					original: HUD,
				});
			} finally {
				chmodSync(join(t.home, ".claude"), 0o700);
			}
		},
	);

	it("tells the user when the consent cannot be withdrawn either", async () => {
		const t = setup({
			settings: { statusLine: HUD },
			replies: { DELETE: [{ status: 500 }] },
		});
		mkdirSync(join(t.home, ".harnessforce", "usage-limits.json"), {
			recursive: true,
		});
		const result = await t.run(["on", "--yes"]);
		expect(result.code).toBe(1);
		expect(result.err).toContain("取り消しにも失敗");
	});
});

describe("harnessforce usage-limits off", () => {
	it("withdraws the consent but leaves a statusLine another tool changed", async () => {
		const other = { type: "command", command: "other-hud" };
		const t = setup({
			settings: { statusLine: other },
			mark: { consented: true, text_version: 1, original: HUD },
		});
		const result = await t.run(["off"]);
		expect(result.code).toBe(0);
		expect(t.readSettings().statusLine).toEqual(other);
		expect(t.readMark()).toBeUndefined();
		expect(t.calls).toEqual([{ method: "DELETE", body: undefined }]);
	});

	it("removes the statusLine when the original was null", async () => {
		const t = setup({
			settings: { statusLine: { type: "command", command: OURS } },
			mark: { consented: true, text_version: 1, original: null },
		});
		await t.run(["off"]);
		expect(t.readSettings().statusLine).toBeUndefined();
	});

	it("changes nothing when the withdrawal fails", async () => {
		const mark = { consented: true, text_version: 1, original: HUD };
		const t = setup({
			settings: { statusLine: { type: "command", command: OURS } },
			mark,
			replies: { DELETE: [{ status: 500 }] },
		});
		const result = await t.run(["off"]);
		expect(result.code).toBe(1);
		expect(t.readSettings().statusLine.command).toBe(OURS);
		expect(t.readMark()).toEqual(mark);
	});

	it("keeps the original but stops sending when the settings cannot be read", async () => {
		const t = setup({
			rawSettings: "{",
			mark: { consented: true, text_version: 1, original: HUD },
		});
		const result = await t.run(["off"]);
		expect(result.code).toBe(1);
		expect(t.readMark()).toEqual({
			consented: false,
			text_version: 1,
			original: HUD,
		});
	});
});

describe("harnessforce usage-limits status", () => {
	const status = async (options: Options) => {
		const result = await setup(options).run(["status"]);
		expect(result.code).toBe(0);
		return result.out;
	};

	it("shows the consent, the Workspace opt-in and the statusLine, and no values", async () => {
		const out = await status({
			settings: { statusLine: { type: "command", command: OURS } },
			mark: { consented: true, text_version: 1, original: HUD },
			replies: {
				GET: [
					{
						status: 200,
						body: {
							workspace_opted_in: true,
							shared: true,
							current_text_version: 1,
						},
					},
				],
			},
		});
		expect(out).toContain("本人の同意: 同意している");
		expect(out).toContain("Workspaceのopt-in: 有効");
		expect(out).toContain("組み込まれている（元のcommandあり）");
	});

	it("says the text is old when the recorded version is not the current one", async () => {
		const out = await status({
			mark: { consented: true, text_version: 1, original: null },
			replies: {
				GET: [
					{
						status: 200,
						body: {
							workspace_opted_in: false,
							shared: false,
							current_text_version: 2,
						},
					},
				],
			},
		});
		expect(out).toContain("本人の同意: 文面が古い");
		expect(out).toContain("Workspaceのopt-in: 無効");
		expect(out).toContain("組み込まれていない");
	});

	it("says it cannot confirm when the request fails", async () => {
		const out = await status({ replies: { GET: [{ status: 500 }] } });
		expect(out).toContain("本人の同意: 確認できません");
		expect(out).toContain("Workspaceのopt-in: 確認できません");
	});

	it("still shows the device state without a user key", async () => {
		const out = await status({ keychain: { items: {} } });
		expect(out).toContain("本人の同意: 確認できません");
		expect(out).toContain("組み込まれていない");
	});
});
