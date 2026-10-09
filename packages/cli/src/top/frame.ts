import type { TopRow, TopSnapshot } from "./reader.js";
import { type SessionState, sessionState } from "./session.js";
import { padEnd, truncate } from "./width.js";

// terminal-view.md「配色」: 色を付けるのは記号、棒、線だけで、本文とラベルには色を指定しない。
export type ColorToken =
	| "good"
	| "warning"
	| "serious"
	| "critical"
	| "primary"
	| "chart1";

export type Painter = {
	color(token: ColorToken, text: string): string;
	bold(text: string): string;
	dim(text: string): string;
};

export const plainPainter: Painter = {
	color: (_token, text) => text,
	bold: (text) => text,
	dim: (text) => text,
};

export type FrameOptions = {
	width: number;
	ascii: boolean;
	// 曖昧な幅の文字を2桁として数える（設定のambiguous_width）。
	ambiguousWide: boolean;
	nowMs: number;
	painter: Painter;
	// 表示している行の番号（絞り込みと並べ替えの後）。
	selectedIndex: number;
	notices: readonly string[];
	paused: boolean;
	// 点字を使う折れ線を使う（設定のbraille）。--asciiでは使わない。
	braille?: boolean;
	// 絞り込みの文字と、並べ替えの基準の表示。
	filterText?: string;
	sortLabel?: string;
};

// terminal-view.md「端末への適応」: 90桁以上は全列、60桁から89桁はtokenとcontextを省き、40桁から59桁は1行の短い形、40桁未満は件数だけ。
const FULL_WIDTH = 90;
const COMPACT_WIDTH = 60;
const SHORT_WIDTH = 40;

type Glyphs = {
	active: string;
	idle: string;
	failure: string;
	marker: string;
	ellipsis: string;
	spark: string;
	separator: string;
};
const UNICODE: Glyphs = {
	active: "●",
	idle: "○",
	failure: "✕",
	marker: ">",
	ellipsis: "…",
	spark: "▁▂▃▄▅▆▇█",
	separator: "·",
};
const ASCII: Glyphs = {
	active: "*",
	idle: "-",
	failure: "x",
	marker: ">",
	ellipsis: "~",
	spark: "._-=*#%@",
	separator: "|",
};
const glyphsOf = (options: FrameOptions) => (options.ascii ? ASCII : UNICODE);

const HINT =
	"q quit  ? help  ↑↓ select  Enter detail  / filter  s sort  p pause  r refresh";
const HINT_ASCII =
	"q quit  ? help  up/down select  Enter detail  / filter  s sort  p pause  r refresh";
const DETAIL_HINT = "Esc back  q quit  p pause  r refresh";

function formatCount(n: number): string {
	if (n < 1000) return String(n);
	if (n < 1_000_000)
		return `${n < 100_000 ? (n / 1000).toFixed(1) : Math.round(n / 1000)}k`.replace(
			".0k",
			"k",
		);
	return `${(n / 1_000_000).toFixed(1)}M`.replace(".0M", "M");
}

function formatElapsed(ms: number): string {
	const minutes = Math.floor(Math.max(0, ms) / 60_000);
	if (minutes < 1) return `${Math.floor(Math.max(0, ms) / 1000)}s`;
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 48) return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
	return `${Math.floor(hours / 24)}d${String(hours % 24).padStart(2, "0")}h`;
}

const repositoryLabel = (row: TopRow): string => {
	const repo = row.repository?.replace(/^github\.com\//, "") ?? "";
	if (repo && row.branch) return `${repo}@${row.branch}`;
	return repo || row.branch || "";
};

const totalTokens = (row: TopRow): string | undefined =>
	row.tokens
		? `${formatCount(row.tokens.input + row.tokens.output + row.tokens.cacheRead + row.tokens.cacheWrite)} ${formatCount(row.tokens.input)}/${formatCount(row.tokens.output)}`
		: undefined;

function clip(text: string, options: FrameOptions): string {
	return truncate(
		text,
		options.width,
		options.ambiguousWide,
		glyphsOf(options).ellipsis,
	);
}

function stateCell(row: TopRow, options: FrameOptions): string {
	const g = glyphsOf(options);
	const state: SessionState = sessionState(row.lastEventAtMs, options.nowMs);
	const glyph = state === "active" ? g.active : g.idle;
	const token = state === "active" ? "good" : "warning";
	return `${options.painter.color(token, glyph)} ${state}`;
}

function toolsCell(row: TopRow, options: FrameOptions): string {
	const g = glyphsOf(options);
	const ratio = `${row.toolFailures}/${row.toolCalls}`;
	return row.toolFailures > 0
		? `${options.painter.color("critical", g.failure)} ${ratio}`
		: ratio;
}

function header(sessions: readonly TopRow[], options: FrameOptions): string {
	const g = glyphsOf(options);
	const active = sessions.filter(
		(s) => sessionState(s.lastEventAtMs, options.nowMs) === "active",
	).length;
	const failures = sessions.reduce((sum, s) => sum + s.toolFailures, 0);
	const parts = [
		options.painter.bold("harnessforce top"),
		`local ${g.separator} ${sessions.length} sessions ${g.separator} ${active} active ${g.separator} ${failures} tool failures`,
	];
	if (options.paused) parts.push("paused");
	if (options.sortLabel) parts.push(`sort: ${options.sortLabel}`);
	if (options.filterText !== undefined)
		parts.push(`filter: ${options.filterText}`);
	return clip(parts.join("  "), options);
}

function footer(options: FrameOptions): string[] {
	return [
		...options.notices.map((notice) => clip(notice, options)),
		clip(options.painter.dim(options.ascii ? HINT_ASCII : HINT), options),
	];
}

type Column = { title: string; width: number; cell: (row: TopRow) => string };

function table(
	sessions: readonly TopRow[],
	options: FrameOptions,
	showUsage: boolean,
): string[] {
	const wide = options.ambiguousWide;
	const fixed: Column[] = [
		{ title: "STATE", width: 9, cell: (r) => stateCell(r, options) },
		{ title: "MODEL", width: 14, cell: (r) => r.model ?? "" },
		{
			title: "ELAPSED",
			width: 7,
			cell: (r) => formatElapsed(r.lastEventAtMs - r.startedAtMs),
		},
		...(showUsage
			? [
					{
						title: "TOKENS",
						width: 17,
						cell: (r: TopRow) => totalTokens(r) ?? "",
					},
					{
						title: "CONTEXT",
						width: 7,
						cell: (r: TopRow) =>
							r.contextTokens === undefined ? "" : formatCount(r.contextTokens),
					},
				]
			: []),
		{ title: "TOOLS", width: 8, cell: (r) => toolsCell(r, options) },
	];
	// 先頭の2桁は選択の印、列の間は1桁。残りの幅をrepositoryとbranchの列に割り当てる。
	const used = 2 + fixed.reduce((sum, c) => sum + c.width + 1, 0);
	const repoWidth = Math.max(8, options.width - used);
	const cells = (r: TopRow | undefined, index: number) => {
		const mark =
			r && index === options.selectedIndex
				? `${options.painter.color("primary", ">")} `
				: "  ";
		const columns = [
			r ? padEnd(stateCell(r, options), 9, wide) : padEnd("STATE", 9, wide),
			padEnd(
				truncate(
					r ? repositoryLabel(r) : "REPO/BRANCH",
					repoWidth,
					wide,
					glyphsOf(options).ellipsis,
				),
				repoWidth,
				wide,
			),
			...fixed
				.slice(1)
				.map((c) =>
					padEnd(
						truncate(
							r ? c.cell(r) : c.title,
							c.width,
							wide,
							glyphsOf(options).ellipsis,
						),
						c.width,
						wide,
					),
				),
		];
		return clip(`${mark}${columns.join(" ")}`.trimEnd(), options);
	};
	return [
		options.painter.dim(cells(undefined, -1)),
		...sessions.map((r, i) => cells(r, i)),
	];
}

function shortRows(
	sessions: readonly TopRow[],
	options: FrameOptions,
): string[] {
	const g = glyphsOf(options);
	return sessions.map((r, i) => {
		const mark =
			i === options.selectedIndex
				? `${options.painter.color("primary", ">")} `
				: "  ";
		const failure =
			r.toolFailures > 0
				? ` ${options.painter.color("critical", g.failure)}${r.toolFailures}`
				: "";
		return clip(
			`${mark}${stateCell(r, options)}${failure} ${repositoryLabel(r)}`,
			options,
		);
	});
}

export function renderList(
	sessions: readonly TopRow[],
	options: FrameOptions,
): string[] {
	if (options.width < SHORT_WIDTH) {
		const active = sessions.filter(
			(s) => sessionState(s.lastEventAtMs, options.nowMs) === "active",
		).length;
		return [clip(`${sessions.length} sessions, ${active} active`, options)];
	}
	const body =
		sessions.length === 0
			? ["直近24時間に記録のあるsessionはありません"].map((t) =>
					clip(t, options),
				)
			: options.width >= COMPACT_WIDTH
				? table(sessions, options, options.width >= FULL_WIDTH)
				: shortRows(sessions, options);
	return [header(sessions, options), ...body, ...footer(options)];
}

function sparkline(values: readonly number[], options: FrameOptions): string {
	const g = glyphsOf(options);
	const max = Math.max(...values, 0);
	const chars = [...g.spark];
	return values
		.map((v) =>
			v <= 0 || max === 0
				? " "
				: (chars[
						Math.min(chars.length - 1, Math.ceil((v / max) * chars.length) - 1)
					] ?? " "),
		)
		.join("");
}

// 点字（1文字に2x4の点）の折れ線。縦は2行、横は値の数の半分の文字で描く。
function brailleLine(values: readonly number[]): string[] {
	const cols = Math.ceil(values.length / 2);
	const rows = 2;
	const height = rows * 4;
	const max = Math.max(...values, 0);
	const grid = Array.from({ length: height }, () =>
		Array<boolean>(cols * 2).fill(false),
	);
	let previous: number | undefined;
	values.forEach((value, x) => {
		const y =
			max === 0
				? height - 1
				: height - 1 - Math.round((value / max) * (height - 1));
		const from = Math.min(y, previous ?? y);
		const to = Math.max(y, previous ?? y);
		for (let row = from; row <= to; row += 1)
			(grid[row] as boolean[])[x] = true;
		previous = y;
	});
	// 点の位置ごとの bit（左列の上から1、2、3、7、右列の上から4、5、6、8）。
	const bits = [
		[0x01, 0x08],
		[0x02, 0x10],
		[0x04, 0x20],
		[0x40, 0x80],
	];
	return Array.from({ length: rows }, (_, r) =>
		Array.from({ length: cols }, (_, c) => {
			let mask = 0;
			for (let dy = 0; dy < 4; dy += 1)
				for (let dx = 0; dx < 2; dx += 1)
					if (grid[r * 4 + dy]?.[c * 2 + dx]) mask |= bits[dy]?.[dx] ?? 0;
			return String.fromCodePoint(0x2800 + mask);
		}).join(""),
	);
}

export function renderDetail(row: TopRow, options: FrameOptions): string[] {
	const g = glyphsOf(options);
	const hours = 24;
	const hourMs = 60 * 60 * 1000;
	const currentHour = Math.floor(options.nowMs / hourMs) * hourMs;
	const series = Array.from({ length: hours }, (_, i) => {
		const start = currentHour - (hours - 1 - i) * hourMs;
		return row.hourlyTokens.find((h) => h.hourStartMs === start)?.tokens ?? 0;
	});
	const lines = [
		`${options.painter.bold(row.sessionId.slice(0, 8))}  ${repositoryLabel(row)}`,
		`${stateCell(row, options)} ${g.separator} ${row.model ?? ""} ${g.separator} ${formatElapsed(row.lastEventAtMs - row.startedAtMs)}`,
	];
	if (row.tokens) {
		const t = row.tokens;
		lines.push(
			`tokens  input ${formatCount(t.input)}  output ${formatCount(t.output)}`,
			`        cache read ${formatCount(t.cacheRead)}  cache write ${formatCount(t.cacheWrite)}`,
		);
	}
	if (row.contextTokens !== undefined)
		lines.push(`context  ${formatCount(row.contextTokens)} tokens`);
	lines.push(
		"tokens per hour (last 24h)",
		...(options.braille && !options.ascii
			? brailleLine(series).map(
					(l) => `  ${options.painter.color("chart1", l)}`,
				)
			: [`  ${options.painter.color("chart1", sparkline(series, options))}`]),
		"tools",
		...row.tools.map(
			(t) =>
				`  ${padEnd(t.tool, 16, options.ambiguousWide)} ${String(t.calls).padStart(4)}${
					t.failures > 0
						? `  ${options.painter.color("critical", g.failure)} ${t.failures}`
						: ""
				}`,
		),
		"responses by model",
		...row.models.map(
			(m) => `  ${padEnd(m.model, 24, options.ambiguousWide)} ${m.responses}`,
		),
	);
	return [
		...lines.map((line) => clip(line, options)),
		...options.notices.map((n) => clip(n, options)),
		clip(options.painter.dim(DETAIL_HINT), options),
	];
}

// 読めなかった行とfileの件数。無ければ空。
export const skippedNotice = (snapshot: TopSnapshot): string[] =>
	snapshot.skippedLines > 0 || snapshot.skippedFiles > 0
		? [
				`読めなかった${snapshot.skippedLines}行と${snapshot.skippedFiles}個のfileを読み飛ばしました`,
			]
		: [];
