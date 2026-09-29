import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { describe, expect, it } from "vitest";

// improvement-loop.md「提案の記録」: `/harnessforce:tune`は`hf tune --json`を実行し、その出力から提案を作る。
// このscriptは`hf tune --json`を起動し、stderrの文言をそのまま流し、「作る条件」を対象ごとに判定して表示する。
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

const session = (id: string, day: number, r: ReturnType<typeof report>) => ({
	session_id: id,
	started_at: at(day),
	transcript_path: `/home/u/.claude/projects/p/${id}.jsonl`,
	repository: "github.com/acme/web",
	sendable: true,
	report: r,
});

const github = (calls: number): McpServer => ({
	server: "github",
	configured: true,
	measurement: "measured",
	calls,
	failures_measurement: "measured",
	failures: 0,
});

function output(sessions: ReturnType<typeof session>[]) {
	return {
		analyzer_version: "1.0.0",
		parser_version: "1.1.0",
		session_count: sessions.length,
		sufficient: sessions.length >= 10,
		repositories_fetched_at: "2026-09-29T00:00:00.000Z",
		sessions,
	};
}

// `hf`の代わりのscript。受け取った引数を記録し、stdoutへ出力、stderrへ文言を書いて、指定の終了コードで終わる。
function fakeHf(stdout: string, stderr: string, code: number) {
	const dir = tempDir("hf-bin-");
	writeFileSync(join(dir, "out.json"), stdout);
	writeFileSync(
		join(dir, "hf"),
		`#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/args.txt"\ncat "${dir}/out.json"\nprintf '%s\\n' '${stderr}' >&2\nexit ${code}\n`,
	);
	chmodSync(join(dir, "hf"), 0o755);
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
	it("runs hf tune --json with the allowed flags and passes hf's exit code and notices through", () => {
		const result = summarize(["--all", "--no-send"], {
			stdout: JSON.stringify(output(sufficientSessions())),
			stderr: "送信しない設定のため、分析結果を送信しません",
			code: 3,
		});
		expect(result.hfArgs).toEqual(["tune", "--json", "--all", "--no-send"]);
		expect(result.code).toBe(3);
		expect(result.stderr).toBe(
			"送信しない設定のため、分析結果を送信しません\n",
		);
	});

	it("refuses other arguments without running hf", () => {
		const result = summarize(["--purge"], { stdout: "" });
		expect(result).toMatchObject({
			code: 2,
			stdout: "",
			stderr: "使い方: /harnessforce:tune [--all] [--no-send]\n",
			hfArgs: undefined,
		});
	});

	it("tells the user to run setup when hf is not on PATH", () => {
		const result = spawnSync(process.execPath, [SCRIPT], {
			encoding: "utf8",
			env: { PATH: tempDir("hf-empty-") },
		});
		expect(result.status).toBe(1);
		expect(result.stderr).toBe(
			"`hf`が見つかりません。`/harnessforce:setup`でCLIを導入してください\n",
		);
	});

	it("prints nothing more when hf ends without an analysis", () => {
		const result = summarize([], {
			stdout: "",
			stderr:
				"`hf init`を実行してください。Viewerのロールでは`hf tune`を利用できません",
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
			"分析したsession: 10件（analyzer 1.0.0、parser 1.1.0）",
		);
		expect(stdout).toContain("  approval: 未計測\n");
		expect(stdout).toContain("  answer: 未計測\n");
		expect(stdout).toContain("  continue: 12回、5 session、30.0秒\n");
		expect(stdout).toContain("  review_relay: 0回、0 session、—\n");
		expect(stdout).toContain("  ci_fix: 2回、介入4回、150.0秒\n");
		expect(stdout).toContain(
			"  github: 設定されていたsession 10件、呼び出し3回、失敗0回\n",
		);
	});

	// improvement-loop.md「作る条件」: 対象ごとの最小の条件を判定し、足りなければあと何が必要かを出す。
	it("judges each target by its minimum condition and says what is missing", () => {
		const { stdout } = summarize([], {
			stdout: JSON.stringify(output(sufficientSessions())),
		});
		expect(stdout).toContain(
			"- intervention.kind=approval: 未計測のため提案しません\n",
		);
		expect(stdout).toContain(
			"- intervention.kind=continue: 提案を作れます（5 session、12回）\n",
		);
		expect(stdout).toContain(
			"- intervention.kind=ci_relay: データ不足: 3 session以上で合計10回以上が必要です（あと2 session、7回）\n",
		);
		expect(stdout).toContain(
			"- loop.kind=ci_fix: データ不足: 合計3回以上が必要です（あと1回）\n",
		);
		expect(stdout).toContain(
			"- mcp_server=github: 提案を作れます（設定されていたsession 10件）\n",
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
			"    根拠のsession（新しい順）:",
			"      s05 2026-09-05T00:00:00.000Z github.com/acme/web sendable=true 4回 /home/u/.claude/projects/p/s05.jsonl",
			"      s04 2026-09-04T00:00:00.000Z github.com/acme/web sendable=true 2回 /home/u/.claude/projects/p/s04.jsonl",
			"      s03 2026-09-03T00:00:00.000Z github.com/acme/web sendable=true 2回 /home/u/.claude/projects/p/s03.jsonl",
			"      s02 2026-09-02T00:00:00.000Z github.com/acme/web sendable=true 2回 /home/u/.claude/projects/p/s02.jsonl",
			"      s01 2026-09-01T00:00:00.000Z github.com/acme/web sendable=true 2回 /home/u/.claude/projects/p/s01.jsonl",
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
		expect(stdout).toContain("- loop.kind=ci_fix: 提案を作れます（合計3回）\n");
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
			"  github: 設定されていたsession 10件、呼び出し: 未計測、失敗: 未計測\n",
		);
		expect(stdout).toContain("- mcp_server=github: 未計測のため提案しません\n");
	});

	// improvement-loop.md「Fidelity」: 10 sessionに満たなければ提案を作らず、必要なsession数を出す。
	it("makes no target when fewer than 10 sessions were analyzed", () => {
		const { stdout, code } = summarize([], {
			stdout: JSON.stringify(output(sufficientSessions().slice(0, 7))),
		});
		expect(code).toBe(0);
		expect(stdout).toContain(
			"データ不足のため提案を作りません: 分析したsessionは7件です。提案には10件以上が必要です（あと3件）\n",
		);
		expect(stdout).not.toContain("提案を作れます");
	});
});
