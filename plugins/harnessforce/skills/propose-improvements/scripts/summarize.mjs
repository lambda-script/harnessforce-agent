// `/harnessforce:tune`が使う。`hf tune --json`を実行し、分析結果と、提案を作る条件の判定を表示する。
// 判定はimprovement-loop.md「作る条件」に従う。hfの文言（stderr）と終了コードはそのまま渡す。
// Node.js 18で依存なしに動かすため、plainなESMで書く。
import { spawnSync } from "node:child_process";

const USAGE = "使い方: /harnessforce:tune [--all] [--no-send]";
const HF_MISSING =
	"`hf`が見つかりません。`/harnessforce:setup`でCLIを導入してください";
const ALLOWED_FLAGS = new Set(["--all", "--no-send"]);

const MINIMUM_SESSIONS = 10;
const INTERVENTION_MIN_SESSIONS = 3;
const INTERVENTION_MIN_COUNT = 10;
const LOOP_MIN_OCCURRENCES = 3;
const MCP_MIN_CONFIGURED_SESSIONS = 10;
const MAX_EVIDENCE = 20;

const INTERVENTION_KINDS = [
	"approval",
	"continue",
	"ci_relay",
	"review_relay",
	"answer",
	"other",
];
const LOOP_KINDS = [
	"issue_to_pr",
	"ci_fix",
	"review_response",
	"test_fix",
	"lint_fix",
	"dependency_update",
];

const median = (values) => {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
};

const secondsText = (value) => (value === null ? "—" : `${value.toFixed(1)}秒`);

const newestFirst = (a, b) =>
	a.session.started_at < b.session.started_at
		? 1
		: a.session.started_at > b.session.started_at
			? -1
			: a.session.session_id.localeCompare(b.session.session_id);

// 計測したsessionだけを合計する。1つも無ければundefined（未計測）とし、0と区別する。
function measure(sessions, pick, countField, medianField) {
	const measured = sessions
		.map((session) => ({ session, value: pick(session.report) }))
		.filter(({ value }) => value?.measurement === "measured");
	if (measured.length === 0) return undefined;
	const hits = measured.filter(({ value }) => value[countField] > 0);
	return {
		total: measured.reduce((sum, { value }) => sum + value[countField], 0),
		median: median(
			measured
				.map(({ value }) => value[medianField])
				.filter((m) => typeof m === "number"),
		),
		hits: hits.map(({ session, value }) => ({
			session,
			count: value[countField],
		})),
		measured,
	};
}

function mcpServers(sessions) {
	const byServer = new Map();
	for (const session of sessions)
		for (const element of session.report.mcp_servers ?? []) {
			const entries = byServer.get(element.server) ?? [];
			entries.push({ session, element });
			byServer.set(element.server, entries);
		}
	return [...byServer.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([server, entries]) => {
			const configured = entries.filter(({ element }) => element.configured);
			const sum = (field, measurement) => {
				const measured = entries.filter(
					({ element }) => element[measurement] === "measured",
				);
				return measured.length === 0
					? undefined
					: measured.reduce((total, { element }) => total + element[field], 0);
			};
			return {
				server,
				configured,
				calls: sum("calls", "measurement"),
				failures: sum("failures", "failures_measurement"),
			};
		});
}

function evidenceLines(hits, unit) {
	const sorted = [...hits].sort(newestFirst);
	const lines = ["    根拠のsession（新しい順）:"];
	for (const { session, count } of sorted.slice(0, MAX_EVIDENCE))
		lines.push(
			`      ${session.session_id} ${session.started_at} ${session.repository ?? "-"} sendable=${session.sendable} ${count}${unit} ${session.transcript_path}`,
		);
	if (sorted.length > MAX_EVIDENCE)
		lines.push(`      ほか${sorted.length - MAX_EVIDENCE}件`);
	return lines;
}

const missing = (parts) =>
	parts
		.filter(([amount]) => amount > 0)
		.map(([amount, unit]) => `${amount}${unit}`)
		.join("、");

function render(output) {
	const { sessions } = output;
	const lines = [
		`分析したsession: ${output.session_count}件（analyzer ${output.analyzer_version}、parser ${output.parser_version}）`,
		"",
		"人の介入（回数、介入のあったsession数、待ち時間の中央値）:",
	];
	const interventions = INTERVENTION_KINDS.map((kind) => ({
		kind,
		result: measure(
			sessions,
			(r) => r.interventions?.[kind],
			"count",
			"wait_seconds_median",
		),
	}));
	for (const { kind, result } of interventions)
		lines.push(
			result === undefined
				? `  ${kind}: 未計測`
				: `  ${kind}: ${result.total}回、${result.hits.length} session、${secondsText(result.median)}`,
		);

	lines.push(
		"",
		"ループにできる繰り返し（回数、その間の介入、所要時間の中央値）:",
	);
	const loops = LOOP_KINDS.map((kind) => ({
		kind,
		result: measure(
			sessions,
			(r) => r.loops?.[kind],
			"occurrences",
			"duration_seconds_median",
		),
	}));
	for (const { kind, result } of loops) {
		if (result === undefined) {
			lines.push(`  ${kind}: 未計測`);
			continue;
		}
		const count = result.measured.reduce(
			(sum, { value }) => sum + value.interventions,
			0,
		);
		lines.push(
			`  ${kind}: ${result.total}回、介入${count}回、${secondsText(result.median)}`,
		);
	}

	lines.push("", "MCP server（設定されていたsession数、呼び出し、失敗）:");
	const servers = mcpServers(sessions);
	if (servers.length === 0) lines.push("  （記録にMCP serverがありません）");
	for (const s of servers)
		lines.push(
			`  ${s.server}: 設定されていたsession ${s.configured.length}件、${s.calls === undefined ? "呼び出し: 未計測" : `呼び出し${s.calls}回`}、${s.failures === undefined ? "失敗: 未計測" : `失敗${s.failures}回`}`,
		);

	lines.push("");
	if (!output.sufficient) {
		lines.push(
			`データ不足のため提案を作りません: 分析したsessionは${output.session_count}件です。提案には${MINIMUM_SESSIONS}件以上が必要です（あと${MINIMUM_SESSIONS - output.session_count}件）`,
		);
		return lines;
	}

	lines.push("提案の対象:");
	for (const { kind, result } of interventions) {
		const category = `intervention.kind=${kind}`;
		if (result === undefined) {
			lines.push(`- ${category}: 未計測のため提案しません`);
			continue;
		}
		const lacking = missing([
			[INTERVENTION_MIN_SESSIONS - result.hits.length, " session"],
			[INTERVENTION_MIN_COUNT - result.total, "回"],
		]);
		if (lacking) {
			lines.push(
				`- ${category}: データ不足: ${INTERVENTION_MIN_SESSIONS} session以上で合計${INTERVENTION_MIN_COUNT}回以上が必要です（あと${lacking}）`,
			);
			continue;
		}
		lines.push(
			`- ${category}: 提案を作れます（${result.hits.length} session、${result.total}回）`,
			...evidenceLines(result.hits, "回"),
		);
	}
	for (const { kind, result } of loops) {
		const category = `loop.kind=${kind}`;
		if (result === undefined) {
			lines.push(`- ${category}: 未計測のため提案しません`);
			continue;
		}
		if (result.total < LOOP_MIN_OCCURRENCES) {
			lines.push(
				`- ${category}: データ不足: 合計${LOOP_MIN_OCCURRENCES}回以上が必要です（あと${LOOP_MIN_OCCURRENCES - result.total}回）`,
			);
			continue;
		}
		lines.push(
			`- ${category}: 提案を作れます（合計${result.total}回）`,
			...evidenceLines(result.hits, "回"),
		);
	}
	// unlistedは構成に無いserverをまとめたものであり、設定されていたsessionを持たないため対象にしない。
	for (const s of servers.filter((server) => server.server !== "unlisted")) {
		const category = `mcp_server=${s.server}`;
		if (s.calls === undefined && s.failures === undefined) {
			lines.push(`- ${category}: 未計測のため提案しません`);
			continue;
		}
		if (s.configured.length < MCP_MIN_CONFIGURED_SESSIONS) {
			lines.push(
				`- ${category}: データ不足: 設定されていたsessionが${MCP_MIN_CONFIGURED_SESSIONS}件以上必要です（あと${MCP_MIN_CONFIGURED_SESSIONS - s.configured.length}件）`,
			);
			continue;
		}
		lines.push(
			`- ${category}: 提案を作れます（設定されていたsession ${s.configured.length}件）`,
			...evidenceLines(
				s.configured.map(({ session, element }) => ({
					session,
					count: element.calls ?? 0,
				})),
				"回の呼び出し",
			),
		);
	}
	return lines;
}

function run(args) {
	if (!args.every((arg) => ALLOWED_FLAGS.has(arg))) {
		process.stderr.write(`${USAGE}\n`);
		return 2;
	}
	// Windowsのnpmのhfは.cmdであり、shellを通さないと起動できない。引数は上で許した値だけである。
	const hf = spawnSync("hf", ["tune", "--json", ...new Set(args)], {
		stdio: ["ignore", "pipe", "inherit"],
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
		shell: process.platform === "win32",
	});
	if (hf.error?.code === "ENOENT") {
		process.stderr.write(`${HF_MISSING}\n`);
		return 1;
	}
	const code = hf.status ?? 1;
	let output;
	try {
		output = JSON.parse(hf.stdout);
	} catch {
		return code;
	}
	process.stdout.write(`${render(output).join("\n")}\n`);
	return code;
}

process.exitCode = run(process.argv.slice(2));
