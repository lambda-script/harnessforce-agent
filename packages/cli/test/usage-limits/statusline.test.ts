import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { describe, expect, it } from "vitest";
import { runCli } from "../support/cli.js";

// usage-limits.md「Claude Code」。claude-hudのstatusLineを元のcommandに持つ端末を含める。
const NOW = new Date("2026-10-10T05:30:00Z");
const FIVE_HOUR_RESET = Date.parse("2026-10-10T08:00:00Z") / 1000;
const SEVEN_DAY_RESET = Date.parse("2026-10-14T00:00:00Z") / 1000;
const HUD_COMMAND =
	// biome-ignore lint/suspicious/noTemplateCurlyInString: shellの展開記号。claude-hudのcommandをそのまま写す。
	"bash -c 'cols=${COLUMNS:-}; exec node \"${plugin_dir}dist/index.js\"'";
// docs/references/claude-hud-statusline.md が記録する、claude-hudが書いたstatusLineの形。
const HUD_STATUS_LINE = {
	type: "command",
	command: HUD_COMMAND,
	refreshInterval: 5,
};
const INPUT = JSON.stringify({
	cwd: "/secret/project",
	transcript_path: "/secret/transcript.jsonl",
	cost: { total_cost_usd: 1.5 },
	rate_limits: {
		five_hour: { used_percentage: 42, resets_at: FIVE_HOUR_RESET },
		seven_day: { used_percentage: 17.5, resets_at: SEVEN_DAY_RESET },
	},
});

type Setup = {
	mark?: unknown;
	input?: string;
	state?: unknown;
	originalCode?: number | undefined;
	now?: Date;
	senderFails?: boolean;
};

function setup(options: Setup = {}) {
	const home = tempDir("hf-usage-limits-");
	mkdirSync(join(home, ".harnessforce"), { recursive: true });
	if (options.mark !== undefined)
		writeFileSync(
			join(home, ".harnessforce", "usage-limits.json"),
			JSON.stringify(options.mark),
		);
	if (options.state !== undefined)
		writeFileSync(
			join(home, ".harnessforce", "usage-limits-state.json"),
			JSON.stringify(options.state),
		);
	const originals: { command: string; input: string }[] = [];
	const payloads: string[] = [];
	const run = () =>
		runCli(["usage-limits", "statusline"], {
			homeDir: home,
			now: () => options.now ?? NOW,
			readStdin: async () => Buffer.from(options.input ?? INPUT),
			runOriginal: async (command, input) => {
				originals.push({ command, input: input.toString("utf8") });
				return options.originalCode;
			},
			spawnSender: (payload) => {
				if (options.senderFails) throw new Error("spawn failed");
				payloads.push(payload);
			},
		});
	return { home, run, originals, payloads };
}

const consented = (original: unknown = HUD_STATUS_LINE) => ({
	consented: true,
	text_version: 1,
	original,
});

describe("harnessforce usage-limits statusline", () => {
	it("runs the wrapped command with the same stdin and returns its exit code", async () => {
		const { run, originals } = setup({
			mark: consented(),
			originalCode: 3,
		});
		const result = await run();
		expect(result).toEqual({ code: 3, out: "", err: "" });
		expect(originals).toEqual([{ command: HUD_COMMAND, input: INPUT }]);
	});

	it("prints nothing and exits 0 without usage-limits.json", async () => {
		const { run, originals, payloads } = setup();
		expect(await run()).toEqual({ code: 0, out: "", err: "" });
		expect(originals).toEqual([]);
		expect(payloads).toEqual([]);
	});

	it("prints nothing and exits 0 when there is no original command", async () => {
		const { run, originals } = setup({ mark: consented(null) });
		expect(await run()).toEqual({ code: 0, out: "", err: "" });
		expect(originals).toEqual([]);
	});

	it("exits 0 when the original command cannot be started", async () => {
		const { run } = setup({ mark: consented(), originalCode: undefined });
		expect((await run()).code).toBe(0);
	});

	it("sends only the percentage and reset time of both windows", async () => {
		const { run, payloads } = setup({ mark: consented() });
		await run();
		expect(payloads).toHaveLength(1);
		expect(JSON.parse(payloads[0] ?? "")).toEqual({
			agent: "claude_code",
			observed_at: "2026-10-10T05:30:00Z",
			windows: [
				{
					window_minutes: 300,
					used_percent: 42,
					resets_at: "2026-10-10T08:00:00Z",
				},
				{
					window_minutes: 10080,
					used_percent: 17.5,
					resets_at: "2026-10-14T00:00:00Z",
				},
			],
		});
		expect(payloads[0]).not.toContain("secret");
	});

	it("records the send time and reset times in a file only the user can use", async () => {
		const { run, home } = setup({ mark: consented() });
		await run();
		const path = join(home, ".harnessforce", "usage-limits-state.json");
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
			sent_at: NOW.getTime(),
			resets_at: { "300": FIVE_HOUR_RESET, "10080": SEVEN_DAY_RESET },
		});
		if (process.platform !== "win32")
			expect(statSync(path).mode & 0o777).toBe(0o600);
	});

	it.each([
		["the user has not consented", { ...consented(), consented: false }],
		["the consent is for an old text", { ...consented(), text_version: 0 }],
	])("sends nothing when %s, and still shows the original", async (_name, mark) => {
		const { run, originals, payloads } = setup({ mark });
		await run();
		expect(payloads).toEqual([]);
		expect(originals).toHaveLength(1);
	});

	it("sends nothing without rate_limits and keeps the original output and exit code", async () => {
		const { run, payloads } = setup({
			mark: consented(),
			input: JSON.stringify({ cwd: "/x" }),
			originalCode: 2,
		});
		expect((await run()).code).toBe(2);
		expect(payloads).toEqual([]);
	});

	it("sends nothing when stdin is not JSON, and returns only the original result", async () => {
		const { run, originals, payloads } = setup({
			mark: consented(),
			input: "not json",
			originalCode: 0,
		});
		expect((await run()).code).toBe(0);
		expect(originals).toEqual([{ command: HUD_COMMAND, input: "not json" }]);
		expect(payloads).toEqual([]);
	});

	it("does not send again within five minutes", async () => {
		const state = {
			sent_at: NOW.getTime() - 4 * 60_000,
			resets_at: { "300": FIVE_HOUR_RESET, "10080": SEVEN_DAY_RESET },
		};
		const { run, payloads } = setup({ mark: consented(), state });
		await run();
		expect(payloads).toEqual([]);
	});

	it("sends again after five minutes", async () => {
		const state = {
			sent_at: NOW.getTime() - 5 * 60_000,
			resets_at: { "300": FIVE_HOUR_RESET, "10080": SEVEN_DAY_RESET },
		};
		const { run, payloads } = setup({ mark: consented(), state });
		await run();
		expect(payloads).toHaveLength(1);
	});

	it("sends within five minutes when a window has a new reset time", async () => {
		const state = {
			sent_at: NOW.getTime() - 60_000,
			resets_at: {
				"300": FIVE_HOUR_RESET - 5 * 3600,
				"10080": SEVEN_DAY_RESET,
			},
		};
		const { run, payloads } = setup({ mark: consented(), state });
		await run();
		expect(payloads).toHaveLength(1);
	});

	it("does not change the result when the send cannot be started", async () => {
		const { run } = setup({
			mark: consented(),
			originalCode: 4,
			senderFails: true,
		});
		expect(await run()).toEqual({ code: 4, out: "", err: "" });
	});

	it("does not send when the send time cannot be recorded", async () => {
		const { run, home, payloads } = setup({ mark: consented() });
		// 状態のfileの場所をdirectoryにして、置き換えを失敗させる。
		mkdirSync(join(home, ".harnessforce", "usage-limits-state.json"));
		expect((await run()).code).toBe(0);
		expect(payloads).toEqual([]);
	});

	it("ignores a usage-limits.json it cannot read", async () => {
		const { run, originals } = setup({ mark: { consented: "yes" } });
		expect(await run()).toEqual({ code: 0, out: "", err: "" });
		expect(originals).toEqual([]);
	});
});
