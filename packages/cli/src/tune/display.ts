import {
	type AnalysisReport,
	INTERVENTION_KINDS,
	LOOP_KINDS,
} from "@harnessforce/semconv";
import { modelShares, type SessionUsage } from "./usage.js";

type Measured = {
	measurement: "measured" | "not_measured";
	[field: string]: number | string | null;
};

const median = (values: readonly number[]): number | null => {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
};

const secondsText = (value: number | null) =>
	value === null ? "—" : `${value.toFixed(1)}秒`;

// kindごとの合計。1つでも計測したsessionがあれば計測した値として合計し、無ければ「未計測」とする（0と区別する）。
function summarize(
	reports: readonly AnalysisReport[],
	group: "interventions" | "loops",
	kind: string,
	countField: string,
	medianField: string,
) {
	const values = reports
		.map((r) => (r[group] as unknown as Record<string, Measured>)[kind])
		.filter((v): v is Measured => v?.measurement === "measured");
	if (values.length === 0) return undefined;
	const total = values.reduce(
		(sum, v) => sum + ((v[countField] as number) ?? 0),
		0,
	);
	const medians = values
		.map((v) => v[medianField])
		.filter((m): m is number => typeof m === "number");
	return { total, median: median(medians), values };
}

// improvement-loop.md「Fidelity」: 未計測のカテゴリは「未計測」と表示し、0と区別する。本文は表示しない。
export function renderAnalysis(
	reports: readonly AnalysisReport[],
	usages: readonly SessionUsage[],
	header: {
		sessionCount: number;
		analyzerVersion: string;
		parserVersion: string;
	},
): string {
	const lines = [
		`分析したsession: ${header.sessionCount}件（analyzer ${header.analyzerVersion}、parser ${header.parserVersion}）`,
		"人の介入（回数、待ち時間のsessionごとの中央値の中央値）:",
	];
	for (const kind of INTERVENTION_KINDS) {
		const s = summarize(
			reports,
			"interventions",
			kind,
			"count",
			"wait_seconds_median",
		);
		lines.push(
			s === undefined
				? `  ${kind}: 未計測`
				: `  ${kind}: ${s.total}回、${secondsText(s.median)}`,
		);
	}
	lines.push(
		"ループにできる繰り返し（回数、その間の介入、所要時間の中央値の中央値）:",
	);
	for (const kind of LOOP_KINDS) {
		const s = summarize(
			reports,
			"loops",
			kind,
			"occurrences",
			"duration_seconds_median",
		);
		const interventions =
			s?.values.reduce(
				(sum, v) => sum + ((v.interventions as number) ?? 0),
				0,
			) ?? 0;
		lines.push(
			s === undefined
				? `  ${kind}: 未計測`
				: `  ${kind}: ${s.total}回、介入${interventions}回、${secondsText(s.median)}`,
		);
	}
	const servers = new Map<
		string,
		{ calls: number | null; failures: number | null; configured: number }
	>();
	for (const report of reports)
		for (const s of report.mcp_servers) {
			const current = servers.get(s.server) ?? {
				calls: 0,
				failures: 0,
				configured: 0,
			};
			servers.set(s.server, {
				calls:
					current.calls === null || s.calls === null
						? null
						: current.calls + s.calls,
				failures:
					current.failures === null || s.failures === null
						? null
						: current.failures + s.failures,
				configured: current.configured + (s.configured ? 1 : 0),
			});
		}
	lines.push("MCP server（呼び出し、失敗、設定されていたsession）:");
	if (servers.size === 0) lines.push("  なし");
	for (const [server, s] of [...servers].sort(([a], [b]) =>
		a < b ? -1 : a > b ? 1 : 0,
	))
		lines.push(
			`  ${server}: ${s.calls === null ? "未計測" : `${s.calls}回`}、${s.failures === null ? "未計測" : `${s.failures}回`}、${s.configured}件`,
		);
	lines.push(...renderUsage(usages));
	return `${lines.join("\n")}\n`;
}

const percent = (share: number) => `${(share * 100).toFixed(1)}%`;

// improvement-loop.md「端末だけの値」: usage.kindごとのsessionの数と、modelごとのoutput_tokensの割合。
function renderUsage(usages: readonly SessionUsage[]): string[] {
	const lines = ["使い方（端末だけの値。送信しません）:"];
	for (const kind of ["frequent_compaction", "low_cache_reuse"] as const)
		lines.push(
			`  ${kind}: ${usages.filter((u) => u.kinds.includes(kind)).length} session`,
		);
	const shares = modelShares(usages);
	const parts = shares && [
		...shares.main.map((m) => `本体 ${m.model} ${percent(m.share)}`),
		...shares.subagent.map((m) => `subagent ${m.model} ${percent(m.share)}`),
	];
	lines.push(
		`  model（output_tokensの割合）: ${parts ? parts.join("、") : "なし"}`,
	);
	return lines;
}

// 端末のtimezoneのoffset付きのISO 8601（improvement-loop.md「文言と終了コード」の取得時刻）。
export function localIso(ms: number): string {
	const offsetMinutes = -new Date(ms).getTimezoneOffset();
	const sign = offsetMinutes >= 0 ? "+" : "-";
	const absolute = Math.abs(offsetMinutes);
	const pad = (n: number) => String(n).padStart(2, "0");
	const local = new Date(ms + offsetMinutes * 60_000)
		.toISOString()
		.slice(0, 19);
	return `${local}${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}
