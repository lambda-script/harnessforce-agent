import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { describe, expect, it } from "vitest";

// improvement-loop.md「提案の記録」: `/harnessforce:tune`は`harnessforce tune --json`を実行し、その出力から提案を作る。
// このscriptは`harnessforce tune --json`を起動し、stderrの文言をそのまま流し、「作る条件」を対象ごとに判定して表示する。
const SCRIPT = fileURLToPath(
	new URL(
		"../skills/propose-improvements/scripts/summarize.mjs",
		import.meta.url,
	),
);

type Measured = Record<string, number | string | null>;

const INTERVENTIONS = [
	"approval",
	"continue",
	"ci_relay",
	"review_relay",
	"answer",
	"other",
];
const LOOPS = [
	"issue_to_pr",
	"ci_fix",
	"review_response",
	"test_fix",
	"lint_fix",
	"dependency_update",
];
const NOT_MEASURED_INTERVENTIONS = new Set(["approval", "answer"]);

type McpServer = {
	server: string;
	configured: boolean;
	measurement: "measured" | "not_measured";
	calls: number | null;
	failures_measurement: "measured" | "not_measured";
	failures: number | null;
};

// analyzer 1.0.0と同じく、approvalとanswerを未計測にした分析結果。
function report(
	id: string,
	startedAt: string,
	options: {
		interventions?: Record<string, [number, number | null]>;
		loops?: Record<string, [number, number, number | null]>;
		mcp?: McpServer[];
	} = {},
) {
	const interventions: Record<string, Measured> = {};
	for (const kind of INTERVENTIONS) {
		const [count, median] = options.interventions?.[kind] ?? [0, null];
		interventions[kind] = NOT_MEASURED_INTERVENTIONS.has(kind)
			? { measurement: "not_measured", count: null, wait_seconds_median: null }
			: { measurement: "measured", count, wait_seconds_median: median };
	}
	const loops: Record<string, Measured> = {};
	for (const kind of LOOPS) {
		const [occurrences, count, median] = options.loops?.[kind] ?? [0, 0, null];
		loops[kind] = {
			measurement: "measured",
			occurrences,
			interventions: count,
			duration_seconds_median: median,
		};
	}
	return {
		agent: "claude_code",
		session_id: id,
		started_at: startedAt,
		analyzer_version: "1.0.0",
		parser_version: "1.1.0",
		interventions,
		loops,
		mcp_servers: options.mcp ?? [],
		proposals: {},
		records_skipped: 0,
	};
}

const at = (day: number) =>
	`2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z`;

type ModelUsage = { model: string; responses: number; output_tokens: number };
type Usage = {
	compactions_auto: number;
	compactions_manual: number;
	responses: number;
	cache_reuse_ratio: number | null;
	models: ModelUsage[] | null;
	subagent_models: ModelUsage[] | null;
	kinds: string[];
};

const USAGE: Usage = {
	compactions_auto: 0,
	compactions_manual: 0,
	responses: 30,
	cache_reuse_ratio: 0.9,
	models: [{ model: "claude-opus-5-5", responses: 30, output_tokens: 100 }],
	subagent_models: [],
	kinds: [],
};

const session = (
	id: string,
	day: number,
	r: ReturnType<typeof report>,
	usage: Partial<Usage> = {},
) => ({
	session_id: id,
	started_at: at(day),
	transcript_path: `/home/u/.claude/projects/p/${id}.jsonl`,
	repository: "github.com/acme/web",
	sendable: true,
	report: r,
	usage: { ...USAGE, ...usage },
});

const github = (calls: number): McpServer => ({
	server: "github",
	configured: true,
	measurement: "measured",
	calls,
	failures_measurement: "measured",
	failures: 0,
});

function output(
	sessions: ReturnType<typeof session>[],
	followups: unknown[] = [],
) {
	return {
		analyzer_version: "1.0.0",
		parser_version: "1.1.0",
		session_count: sessions.length,
		sufficient: sessions.length >= 10,
		repositories_fetched_at: "2026-09-29T00:00:00.000Z",
		sessions,
		followups,
	};
}

// `harnessforce`の代わりのscript。受け取った引数を記録し、stdoutへ出力、stderrへ文言を書いて、指定の終了コードで終わる。
function fakeHf(stdout: string, stderr: string, code: number) {
	const dir = tempDir("hf-bin-");
	writeFileSync(join(dir, "out.json"), stdout);
	writeFileSync(
		join(dir, "harnessforce"),
		`#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/args.txt"\ncat "${dir}/out.json"\nprintf '%s\\n' '${stderr}' >&2\nexit ${code}\n`,
	);
	chmodSync(join(dir, "harnessforce"), 0o755);
	return dir;
}

function summarize(
	args: string[],
	hf: { stdout: string; stderr?: string; code?: number },
) {
	const dir = fakeHf(hf.stdout, hf.stderr ?? "notice", hf.code ?? 0);
	const result = spawnSync(process.execPath, [SCRIPT, ...args], {
		encoding: "utf8",
		env: { PATH: `${dir}:${process.env.PATH ?? ""}` },
	});
	const argsFile = join(dir, "args.txt");
	return {
		code: result.status,
		stdout: result.stdout,
		stderr: result.stderr,
		hfArgs: existsSync(argsFile)
			? readFileSync(argsFile, "utf8").trim().split("\n")
			: undefined,
	};
}

// 10 session。continueは5 sessionで合計12回、ci_relayは1 sessionで3回、ci_fixは合計2回、githubは12件目以降も含め10 sessionで設定されている。
function sufficientSessions() {
	return Array.from({ length: 10 }, (_, i) => {
		const day = i + 1;
		const id = `s${String(day).padStart(2, "0")}`;
		return session(
			id,
			day,
			report(id, at(day), {
				interventions: {
					...(day <= 5 ? { continue: [day === 5 ? 4 : 2, 10 * day] } : {}),
					...(day === 1 ? { ci_relay: [3, 60] } : {}),
				},
				loops: day <= 2 ? { ci_fix: [1, 2, 100 * day] } : {},
				mcp: [github(day <= 3 ? 1 : 0)],
			}),
		);
	});
}

describe.skipIf(process.platform === "win32")("tune summary script", () => {
	it("runs harnessforce tune --json with the allowed flags and passes harnessforce's exit code and notices through", () => {
		const result = summarize(["--all", "--no-send"], {
			stdout: JSON.stringify(output(sufficientSessions())),
			stderr: "Sending is turned off, so the analysis results are not sent",
			code: 3,
		});
		expect(result.hfArgs).toEqual(["tune", "--json", "--all", "--no-send"]);
		expect(result.code).toBe(3);
		expect(result.stderr).toBe(
			"Sending is turned off, so the analysis results are not sent\n",
		);
	});

	it("refuses other arguments without running harnessforce", () => {
		const result = summarize(["--purge"], { stdout: "" });
		expect(result).toMatchObject({
			code: 2,
			stdout: "",
			stderr: "Usage: /harnessforce:tune [--all] [--no-send]\n",
			hfArgs: undefined,
		});
	});

	it("tells the user to run setup when harnessforce is not on PATH", () => {
		const result = spawnSync(process.execPath, [SCRIPT], {
			encoding: "utf8",
			env: { PATH: tempDir("hf-empty-") },
		});
		expect(result.status).toBe(1);
		expect(result.stderr).toBe(
			"`harnessforce` was not found. Install the CLI with `/harnessforce:setup`\n",
		);
	});

	it("prints nothing more when harnessforce ends without an analysis", () => {
		const result = summarize([], {
			stdout: "",
			stderr:
				"Run `harnessforce init`. The Viewer role cannot use `harnessforce tune`",
			code: 1,
		});
		expect(result).toMatchObject({ code: 1, stdout: "" });
	});

	// improvement-loop.md「Fidelity」: 未計測のカテゴリは「未計測」と表示し、0と区別する。
	it("shows the analysis by category and keeps not measured apart from zero", () => {
		const { stdout } = summarize([], {
			stdout: JSON.stringify(output(sufficientSessions())),
		});
		expect(stdout).toContain(
			"Sessions analyzed: 10 (analyzer 1.0.0, parser 1.1.0)",
		);
		expect(stdout).toContain("  approval: not measured\n");
		expect(stdout).toContain("  answer: not measured\n");
		expect(stdout).toContain("  continue: 12 time(s), 5 session(s), 30.0s\n");
		expect(stdout).toContain("  review_relay: 0 time(s), 0 session(s), —\n");
		expect(stdout).toContain(
			"  ci_fix: 2 time(s), 4 intervention(s), 150.0s\n",
		);
		expect(stdout).toContain(
			"  github: configured in 10 session(s), 3 call(s), 0 failure(s)\n",
		);
	});

	// improvement-loop.md「作る条件」: 対象ごとの最小の条件を判定し、足りなければあと何が必要かを出す。
	it("judges each target by its minimum condition and says what is missing", () => {
		const { stdout } = summarize([], {
			stdout: JSON.stringify(output(sufficientSessions())),
		});
		expect(stdout).toContain(
			"- intervention.kind=approval: not measured, so no suggestion is made\n",
		);
		expect(stdout).toContain(
			"- intervention.kind=continue: a suggestion can be made (5 session(s), 12 time(s))\n",
		);
		expect(stdout).toContain(
			"- intervention.kind=ci_relay: Not enough data: needs at least 3 sessions and at least 10 times in total (2 session(s), 7 time(s) more needed)\n",
		);
		expect(stdout).toContain(
			"- loop.kind=ci_fix: Not enough data: needs at least 3 times in total (1 more needed)\n",
		);
		expect(stdout).toContain(
			"- mcp_server=github: a suggestion can be made (configured in 10 session(s))\n",
		);
	});

	it("lists the evidence sessions of a target newest first", () => {
		const { stdout } = summarize([], {
			stdout: JSON.stringify(output(sufficientSessions())),
		});
		const evidence = stdout
			.slice(stdout.indexOf("- intervention.kind=continue:"))
			.split("\n")
			.slice(1, 7);
		expect(evidence).toEqual([
			"    Evidence sessions (newest first):",
			"      s05 2026-09-05T00:00:00.000Z github.com/acme/web sendable=true 4 time(s) /home/u/.claude/projects/p/s05.jsonl",
			"      s04 2026-09-04T00:00:00.000Z github.com/acme/web sendable=true 2 time(s) /home/u/.claude/projects/p/s04.jsonl",
			"      s03 2026-09-03T00:00:00.000Z github.com/acme/web sendable=true 2 time(s) /home/u/.claude/projects/p/s03.jsonl",
			"      s02 2026-09-02T00:00:00.000Z github.com/acme/web sendable=true 2 time(s) /home/u/.claude/projects/p/s02.jsonl",
			"      s01 2026-09-01T00:00:00.000Z github.com/acme/web sendable=true 2 time(s) /home/u/.claude/projects/p/s01.jsonl",
		]);
	});

	it("does not offer a loop with three occurrences as missing anything", () => {
		const sessions = sufficientSessions().map((s, i) =>
			i === 2
				? session(
						s.session_id,
						3,
						report(s.session_id, s.started_at, {
							loops: { ci_fix: [1, 0, 50] },
						}),
					)
				: s,
		);
		const { stdout } = summarize([], {
			stdout: JSON.stringify(output(sessions)),
		});
		expect(stdout).toContain(
			"- loop.kind=ci_fix: a suggestion can be made (3 time(s) in total)\n",
		);
	});

	it("does not treat an MCP server whose calls and failures are not measured as a target", () => {
		const sessions = sufficientSessions().map((s) =>
			session(
				s.session_id,
				Number(s.session_id.slice(1)),
				report(s.session_id, s.started_at, {
					mcp: [
						{
							server: "github",
							configured: true,
							measurement: "not_measured",
							calls: null,
							failures_measurement: "not_measured",
							failures: null,
						},
					],
				}),
			),
		);
		const { stdout } = summarize([], {
			stdout: JSON.stringify(output(sessions)),
		});
		expect(stdout).toContain(
			"  github: configured in 10 session(s), calls: not measured, failures: not measured\n",
		);
		expect(stdout).toContain(
			"- mcp_server=github: not measured, so no suggestion is made\n",
		);
	});

	// improvement-loop.md「作る条件」: 使い方のfrequent_compactionとlow_cache_reuseは、当たるsessionが3以上。
	it("offers a usage kind with 3 matching sessions and says how many more are needed otherwise", () => {
		const sessions = sufficientSessions().map((s, i) =>
			session(s.session_id, i + 1, s.report, {
				kinds: [
					...(i < 3 ? ["frequent_compaction"] : []),
					...(i < 2 ? ["low_cache_reuse"] : []),
				],
			}),
		);
		const { stdout } = summarize([], {
			stdout: JSON.stringify(output(sessions)),
		});
		expect(stdout).toContain(
			"Usage (matching sessions):\n  frequent_compaction: 3 session(s)\n  low_cache_reuse: 2 session(s)\n",
		);
		expect(stdout).toContain(
			"- usage.kind=frequent_compaction: a suggestion can be made (3 session(s))\n    Evidence sessions (newest first):\n      s03 ",
		);
		expect(stdout).toContain(
			"- usage.kind=low_cache_reuse: Not enough data: needs at least 3 matching sessions (1 more session(s) needed)\n",
		);
	});

	// 「作る条件」: model_choiceは、modelsを持つsessionが10以上で、1つのmodelが本体のoutput_tokensの90%以上。
	it("offers model_choice only when one model has 90% of the main output tokens over 10 sessions", () => {
		const withModels = (tokens: [number, number]) =>
			sufficientSessions().map((s, i) =>
				session(s.session_id, i + 1, s.report, {
					models: [
						{
							model: "claude-opus-5-5",
							responses: 1,
							output_tokens: tokens[0],
						},
						{
							model: "claude-sonnet-5",
							responses: 1,
							output_tokens: tokens[1],
						},
					],
				}),
			);
		const dominant = summarize([], {
			stdout: JSON.stringify(output(withModels([95, 5]))),
		}).stdout;
		expect(dominant).toContain(
			"- usage.kind=model_choice: a suggestion can be made (10 session(s), claude-opus-5-5 95.0%)\n",
		);
		expect(dominant).toContain(
			"  model (share of output_tokens): main claude-opus-5-5 95.0%, main claude-sonnet-5 5.0%\n",
		);
		expect(
			summarize([], { stdout: JSON.stringify(output(withModels([60, 40]))) })
				.stdout,
		).toContain(
			"- usage.kind=model_choice: not suggested: no single model accounts for 90% or more of the main output_tokens (largest: claude-opus-5-5 60.0%)\n",
		);
		const fewer = withModels([95, 5]).map((s, i) =>
			i < 2 ? { ...s, usage: { ...s.usage, models: [] } } : s,
		);
		expect(
			summarize([], { stdout: JSON.stringify(output(fewer)) }).stdout,
		).toContain(
			"- usage.kind=model_choice: Not enough data: needs at least 10 sessions with models (2 more session(s) needed)\n",
		);
	});

	// 「前回の提案の前後」: 新しい提案の前に表示し、因果を示さないことと、起点が検出の時刻であることを添える。
	it("shows the before and after of earlier proposals before the targets", () => {
		const period = (
			from: string,
			to: string,
			sessions: number,
			value: unknown,
		) => ({
			from,
			to,
			sessions,
			value,
		});
		const followup = (
			category: string,
			before: unknown,
			after: unknown,
			fields: Record<string, unknown> = {},
		) => ({
			proposal_id: `p-${category}`,
			category,
			change_type: "skill",
			path: "/home/u/.claude/skills/x/SKILL.md",
			origin: "2026-09-15T00:00:00.000Z",
			before: period(
				"2026-09-01T00:00:00.000Z",
				"2026-09-15T00:00:00.000Z",
				6,
				before,
			),
			after: period(
				"2026-09-15T00:00:00.000Z",
				"2026-09-29T00:00:00.000Z",
				5,
				after,
			),
			no_comparison_data: false,
			before_outside_range: false,
			...fields,
		});
		const { stdout } = summarize([], {
			stdout: JSON.stringify(
				output(sufficientSessions(), [
					followup("intervention.kind=continue", 3, 1),
					followup("usage.kind=low_cache_reuse", 0.4, 0.3),
					followup("loop.kind=ci_fix", 2, 2, {
						no_comparison_data: true,
						before_outside_range: true,
					}),
					followup(
						"usage.kind=model_choice",
						{ main: [{ model: "claude-opus-5-5", share: 1 }], subagent: [] },
						{
							main: [{ model: "claude-opus-5-5", share: 0.6 }],
							subagent: [{ model: "claude-haiku-4-5", share: 0.4 }],
						},
					),
				]),
			),
		});
		const section = stdout.slice(
			stdout.indexOf("Before and after the previous suggestion"),
		);
		expect(
			stdout.indexOf("Before and after the previous suggestion"),
		).toBeLessThan(stdout.indexOf("Targets for suggestions:"));
		expect(section).toContain(
			"Before and after the previous suggestion (Before/after difference (does not show causation). The starting point is the time the application was detected):\n- intervention.kind=continue (skill /home/u/.claude/skills/x/SKILL.md) starting point 2026-09-15T00:00:00.000Z\n    Before 2026-09-01T00:00:00.000Z to 2026-09-15T00:00:00.000Z: 6 session(s), 3\n    After 2026-09-15T00:00:00.000Z to 2026-09-29T00:00:00.000Z: 5 session(s), 1\n",
		);
		const block = (category: string) =>
			`${section.slice(section.indexOf(`- ${category}`)).split("\n- ")[0]}\n`;
		expect(block("intervention.kind=continue")).not.toContain(
			"improving direction",
		);
		expect(block("usage.kind=low_cache_reuse")).toContain(
			"    Did not move in the improving direction. Use this as the basis when making a suggestion for the same target",
		);
		expect(block("loop.kind=ci_fix")).toContain("    No comparison data\n");
		expect(block("loop.kind=ci_fix")).toContain(
			"    Part of the earlier period is outside the analysis range\n",
		);
		expect(block("loop.kind=ci_fix")).not.toContain("improving direction");
		expect(block("usage.kind=model_choice")).toContain(
			"    After 2026-09-15T00:00:00.000Z to 2026-09-29T00:00:00.000Z: 5 session(s), main claude-opus-5-5 60.0%, subagent claude-haiku-4-5 40.0%\n",
		);
		expect(block("usage.kind=model_choice")).not.toContain(
			"improving direction",
		);
	});

	// improvement-loop.md「Fidelity」: 10 sessionに満たなければ提案を作らず、必要なsession数を出す。
	it("makes no target when fewer than 10 sessions were analyzed", () => {
		const { stdout, code } = summarize([], {
			stdout: JSON.stringify(output(sufficientSessions().slice(0, 7))),
		});
		expect(code).toBe(0);
		expect(stdout).toContain(
			"Not enough data, so no suggestions are made: 7 session(s) analyzed. Suggestions need at least 10 (3 more needed)\n",
		);
		expect(stdout).not.toContain("a suggestion can be made");
	});
});
