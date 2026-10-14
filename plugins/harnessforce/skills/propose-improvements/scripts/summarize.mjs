// `/harnessforce:tune`が使う。`harnessforce tune --json`を実行し、分析結果と、提案を作る条件の判定を表示する。
// 判定はimprovement-loop.md「作る条件」に従う。harnessforceの文言（stderr）と終了コードはそのまま渡す。
// Node.js 18で依存なしに動かすため、plainなESMで書く。
import { spawnSync } from "node:child_process";

const USAGE = "Usage: /harnessforce:tune [--all] [--no-send]";
const HF_MISSING =
	"`harnessforce` was not found. Install the CLI with `/harnessforce:setup`";
const ALLOWED_FLAGS = new Set(["--all", "--no-send"]);

const MINIMUM_SESSIONS = 10;
const INTERVENTION_MIN_SESSIONS = 3;
const INTERVENTION_MIN_COUNT = 10;
const LOOP_MIN_OCCURRENCES = 3;
const MCP_MIN_CONFIGURED_SESSIONS = 10;
const MAX_EVIDENCE = 20;
const USAGE_MIN_SESSIONS = 3;
const MODEL_CHOICE_MIN_SESSIONS = 10;
const MODEL_CHOICE_MIN_SHARE = 0.9;
// 使い方のうち、sessionごとに判定する種類。model_choiceは分析した範囲の合計で判定する。
const SESSION_USAGE_KINDS = ["frequent_compaction", "low_cache_reuse"];
// improvement-loop.md「前回の提案の前後」の「良くなった向き」。model_choiceは向きを持たない。
const IMPROVES_BY = {
	"intervention.kind": "decrease",
	"loop.kind": "decrease",
	mcp_server: "decrease",
	"usage.kind=frequent_compaction": "decrease",
	"usage.kind=low_cache_reuse": "increase",
};

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

const secondsText = (value) => (value === null ? "—" : `${value.toFixed(1)}s`);

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
	const lines = ["    Evidence sessions (newest first):"];
	for (const { session, count } of sorted.slice(0, MAX_EVIDENCE))
		lines.push(
			`      ${session.session_id} ${session.started_at} ${session.repository ?? "-"} sendable=${session.sendable} ${count}${unit} ${session.transcript_path}`,
		);
	if (sorted.length > MAX_EVIDENCE)
		lines.push(`      and ${sorted.length - MAX_EVIDENCE} more`);
	return lines;
}

const missing = (parts) =>
	parts
		.filter(([amount]) => amount > 0)
		.map(([amount, unit]) => `${amount}${unit}`)
		.join(", ");

const percent = (share) => `${(share * 100).toFixed(1)}%`;

// `models`（本体）と`subagent_models`の合計を分母にした、modelごとのoutput_tokensの割合。
// どちらかがnullのsessionは除く。分母が0ならnull。
function modelShares(sessions) {
	const counted = sessions.filter(
		(s) =>
			s.usage && s.usage.models !== null && s.usage.subagent_models !== null,
	);
	const totals = (field) => {
		const byModel = new Map();
		for (const s of counted)
			for (const m of s.usage[field])
				byModel.set(m.model, (byModel.get(m.model) ?? 0) + m.output_tokens);
		return byModel;
	};
	const main = totals("models");
	const subagent = totals("subagent_models");
	const denominator = [...main.values(), ...subagent.values()].reduce(
		(total, v) => total + v,
		0,
	);
	if (denominator === 0) return null;
	const shares = (byModel) =>
		[...byModel]
			// harnessforce tune の表示（UTF-16 の code unit 順）と並びを揃える。
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([model, tokens]) => ({ model, share: tokens / denominator }));
	return { main: shares(main), subagent: shares(subagent) };
}

const sharesText = (shares) =>
	shares === null
		? "none"
		: [
				...shares.main.map((m) => `main ${m.model} ${percent(m.share)}`),
				...shares.subagent.map(
					(m) => `subagent ${m.model} ${percent(m.share)}`,
				),
			].join(", ");

// 「作る条件」の`model_choice`: 分析した範囲の`models`の合計で、output_tokensが最も多いmodelとその割合。
function topMainModel(sessions) {
	const byModel = new Map();
	for (const s of sessions)
		for (const m of s.usage.models)
			byModel.set(m.model, (byModel.get(m.model) ?? 0) + m.output_tokens);
	const total = [...byModel.values()].reduce((sum, v) => sum + v, 0);
	const [model, tokens] = [...byModel].sort(
		([a, x], [b, y]) => y - x || a.localeCompare(b),
	)[0] ?? [undefined, 0];
	return model === undefined || total === 0
		? undefined
		: { model, tokens, share: tokens / total };
}

const valueText = (value) =>
	value === null
		? "no value"
		: typeof value === "number"
			? String(Number(value.toFixed(3)))
			: sharesText(value);

function improvesBy(category) {
	return IMPROVES_BY[category] ?? IMPROVES_BY[category.split("=")[0]];
}

// improvement-loop.md「前回の提案の前後」
function renderFollowups(followups) {
	if (!Array.isArray(followups) || followups.length === 0) return [];
	const lines = [
		"Before and after the previous suggestion (Before/after difference (does not show causation). The starting point is the time the application was detected):",
	];
	for (const f of followups) {
		lines.push(
			`- ${f.category} (${f.change_type} ${f.path}) starting point ${f.origin}`,
			`    Before ${f.before.from} to ${f.before.to}: ${f.before.sessions} session(s), ${valueText(f.before.value)}`,
			`    After ${f.after.from} to ${f.after.to}: ${f.after.sessions} session(s), ${valueText(f.after.value)}`,
		);
		if (f.no_comparison_data) lines.push("    No comparison data");
		if (f.before_outside_range)
			lines.push(
				"    Part of the earlier period is outside the analysis range",
			);
		const direction = improvesBy(f.category);
		const isImproved =
			direction === "decrease"
				? f.after.value < f.before.value
				: f.after.value > f.before.value;
		if (direction !== undefined && !f.no_comparison_data && !isImproved)
			lines.push(
				"    Did not move in the improving direction. Use this as the basis when making a suggestion for the same target",
			);
	}
	lines.push("");
	return lines;
}

function usageTargets(sessions) {
	const lines = [];
	// usage を出力しない古い harnessforce の出力では、使い方を未計測として扱い提案を作らない。
	const withUsage = sessions.filter((s) => s.usage);
	for (const kind of SESSION_USAGE_KINDS) {
		const category = `usage.kind=${kind}`;
		if (withUsage.length === 0) {
			lines.push(`- ${category}: not measured, so no suggestion is made`);
			continue;
		}
		const hits = withUsage.filter((s) => s.usage.kinds.includes(kind));
		if (hits.length < USAGE_MIN_SESSIONS) {
			lines.push(
				`- ${category}: Not enough data: needs at least ${USAGE_MIN_SESSIONS} matching sessions (${USAGE_MIN_SESSIONS - hits.length} more session(s) needed)`,
			);
			continue;
		}
		lines.push(
			`- ${category}: a suggestion can be made (${hits.length} session(s))`,
			...evidenceLines(
				hits.map((session) => ({
					session,
					count:
						kind === "frequent_compaction"
							? session.usage.compactions_auto
							: Number(session.usage.cache_reuse_ratio.toFixed(3)),
				})),
				kind === "frequent_compaction"
					? " auto-compaction(s)"
					: " (cache reuse ratio)",
			),
		);
	}
	const category = "usage.kind=model_choice";
	const withModels = withUsage.filter(
		(s) => Array.isArray(s.usage.models) && s.usage.models.length > 0,
	);
	if (withUsage.length === 0) {
		lines.push(`- ${category}: not measured, so no suggestion is made`);
		return lines;
	}
	if (withModels.length < MODEL_CHOICE_MIN_SESSIONS) {
		lines.push(
			`- ${category}: Not enough data: needs at least ${MODEL_CHOICE_MIN_SESSIONS} sessions with models (${MODEL_CHOICE_MIN_SESSIONS - withModels.length} more session(s) needed)`,
		);
		return lines;
	}
	const top = topMainModel(withModels);
	if (top === undefined || top.share < MODEL_CHOICE_MIN_SHARE) {
		lines.push(
			`- ${category}: not suggested: no single model accounts for ${MODEL_CHOICE_MIN_SHARE * 100}% or more of the main output_tokens${top ? ` (largest: ${top.model} ${percent(top.share)})` : ""}`,
		);
		return lines;
	}
	lines.push(
		`- ${category}: a suggestion can be made (${withModels.length} session(s), ${top.model} ${percent(top.share)})`,
		...evidenceLines(
			withModels.map((session) => ({
				session,
				count:
					session.usage.models.find((m) => m.model === top.model)
						?.output_tokens ?? 0,
			})),
			` output_tokens (${top.model})`,
		),
	);
	return lines;
}

function render(output) {
	const { sessions } = output;
	const lines = [
		`Sessions analyzed: ${output.session_count} (analyzer ${output.analyzer_version}, parser ${output.parser_version})`,
		"",
		"Human interventions (count, sessions with interventions, median wait time):",
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
				? `  ${kind}: not measured`
				: `  ${kind}: ${result.total} time(s), ${result.hits.length} session(s), ${secondsText(result.median)}`,
		);

	lines.push(
		"",
		"Repeatable loops (count, interventions during them, median duration):",
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
			lines.push(`  ${kind}: not measured`);
			continue;
		}
		const count = result.measured.reduce(
			(sum, { value }) => sum + value.interventions,
			0,
		);
		lines.push(
			`  ${kind}: ${result.total} time(s), ${count} intervention(s), ${secondsText(result.median)}`,
		);
	}

	lines.push("", "MCP servers (sessions where configured, calls, failures):");
	const servers = mcpServers(sessions);
	if (servers.length === 0) lines.push("  (no MCP servers in the records)");
	for (const s of servers)
		lines.push(
			`  ${s.server}: configured in ${s.configured.length} session(s), ${s.calls === undefined ? "calls: not measured" : `${s.calls} call(s)`}, ${s.failures === undefined ? "failures: not measured" : `${s.failures} failure(s)`}`,
		);

	const withUsage = sessions.filter((s) => s.usage);
	lines.push("", "Usage (matching sessions):");
	for (const kind of SESSION_USAGE_KINDS)
		lines.push(
			withUsage.length === 0
				? `  ${kind}: not measured`
				: `  ${kind}: ${withUsage.filter((s) => s.usage.kinds.includes(kind)).length} session(s)`,
		);
	lines.push(
		`  model (share of output_tokens): ${sharesText(modelShares(withUsage))}`,
	);

	lines.push("", ...renderFollowups(output.followups));
	if (!output.sufficient) {
		lines.push(
			`Not enough data, so no suggestions are made: ${output.session_count} session(s) analyzed. Suggestions need at least ${MINIMUM_SESSIONS} (${MINIMUM_SESSIONS - output.session_count} more needed)`,
		);
		return lines;
	}

	lines.push("Targets for suggestions:");
	for (const { kind, result } of interventions) {
		const category = `intervention.kind=${kind}`;
		if (result === undefined) {
			lines.push(`- ${category}: not measured, so no suggestion is made`);
			continue;
		}
		const lacking = missing([
			[INTERVENTION_MIN_SESSIONS - result.hits.length, " session(s)"],
			[INTERVENTION_MIN_COUNT - result.total, " time(s)"],
		]);
		if (lacking) {
			lines.push(
				`- ${category}: Not enough data: needs at least ${INTERVENTION_MIN_SESSIONS} sessions and at least ${INTERVENTION_MIN_COUNT} times in total (${lacking} more needed)`,
			);
			continue;
		}
		lines.push(
			`- ${category}: a suggestion can be made (${result.hits.length} session(s), ${result.total} time(s))`,
			...evidenceLines(result.hits, " time(s)"),
		);
	}
	for (const { kind, result } of loops) {
		const category = `loop.kind=${kind}`;
		if (result === undefined) {
			lines.push(`- ${category}: not measured, so no suggestion is made`);
			continue;
		}
		if (result.total < LOOP_MIN_OCCURRENCES) {
			lines.push(
				`- ${category}: Not enough data: needs at least ${LOOP_MIN_OCCURRENCES} times in total (${LOOP_MIN_OCCURRENCES - result.total} more needed)`,
			);
			continue;
		}
		lines.push(
			`- ${category}: a suggestion can be made (${result.total} time(s) in total)`,
			...evidenceLines(result.hits, " time(s)"),
		);
	}
	// unlistedは構成に無いserverをまとめたものであり、設定されていたsessionを持たないため対象にしない。
	for (const s of servers.filter((server) => server.server !== "unlisted")) {
		const category = `mcp_server=${s.server}`;
		if (s.calls === undefined && s.failures === undefined) {
			lines.push(`- ${category}: not measured, so no suggestion is made`);
			continue;
		}
		if (s.configured.length < MCP_MIN_CONFIGURED_SESSIONS) {
			lines.push(
				`- ${category}: Not enough data: needs at least ${MCP_MIN_CONFIGURED_SESSIONS} sessions where it was configured (${MCP_MIN_CONFIGURED_SESSIONS - s.configured.length} more needed)`,
			);
			continue;
		}
		lines.push(
			`- ${category}: a suggestion can be made (configured in ${s.configured.length} session(s))`,
			...evidenceLines(
				s.configured.map(({ session, element }) => ({
					session,
					count: element.calls ?? 0,
				})),
				" call(s)",
			),
		);
	}
	lines.push(...usageTargets(sessions));
	return lines;
}

function run(args) {
	if (!args.every((arg) => ALLOWED_FLAGS.has(arg))) {
		process.stderr.write(`${USAGE}\n`);
		return 2;
	}
	// Windowsのnpmのharnessforceは.cmdであり、shellを通さないと起動できない。引数は上で許した値だけである。
	const hf = spawnSync("harnessforce", ["tune", "--json", ...new Set(args)], {
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
