import type { TopArgs } from "./args.js";
import {
	createPainter,
	isColorDisabled,
	parseOsc11,
	type Rgb,
} from "./color.js";
import { renderDetail, renderList, skippedNotice } from "./frame.js";
import { DEFAULT_COLUMNS, type TopIo } from "./io.js";
import type { createTopReader, TopRow, TopSnapshot } from "./reader.js";
import type { TopSettings } from "./settings.js";

// 画面の制御。alternate screenに入り、cursorを隠す。出るときはもとに戻す。
const ENTER = "\x1b[?1049h\x1b[?25l";
const RESTORE = "\x1b[?25h\x1b[?1049l";
const HOME = "\x1b[H";
const CLEAR_LINE_END = "\x1b[K";
const CLEAR_BELOW = "\x1b[J";
const OSC_BACKGROUND_QUERY = "\x1b]11;?\x07";
// terminal-view.md「配色」手順2: 端末の応答を待つ上限。
const OSC_TIMEOUT_MS = 100;
// terminal-view.md「読むもの」: 画面を開いている間の更新の間隔。
const REFRESH_MS = 2000;

type Reader = ReturnType<typeof createTopReader>;

export type ScreenOptions = {
	args: TopArgs;
	settings: TopSettings;
	settingsNotice: string | undefined;
	reader: Reader;
	first: TopSnapshot;
	io: TopIo;
	env: Readonly<Record<string, string | undefined>>;
	now: () => number;
};

type Mode = "list" | "detail" | "help" | "filter";

const SORTS = [
	{
		label: "last event",
		key: (r: TopRow) => r.lastEventAtMs,
	},
	{ label: "start", key: (r: TopRow) => r.startedAtMs },
	{
		label: "tokens",
		key: (r: TopRow) =>
			r.tokens
				? r.tokens.input +
					r.tokens.output +
					r.tokens.cacheRead +
					r.tokens.cacheWrite
				: -1,
	},
	{ label: "tool failures", key: (r: TopRow) => r.toolFailures },
] as const;

const HELP_LINES = [
	"q, Ctrl-C   quit",
	"?           this help",
	"↑ ↓, j k    select a session",
	"Enter, Esc  open the detail, go back",
	"/           filter the rows by text (Enter applies, Esc clears)",
	"s           change the order",
	"p           pause or resume the refresh",
	"r           refresh now",
	"",
	"Press any key to go back.",
];

// 1回の入力のchunkを、キーの列に分ける。矢印などのescape sequenceは1つのキーとして扱う。
// biome-ignore lint/suspicious/noControlCharactersInRegex: 端末の制御文字を扱う。
const KEYS = /\x1b\[[0-9;]*[A-Za-z~]|\x1bO[A-Za-z]|\x1b|[\s\S]/gu;
// 端末が返したOSCの応答。キーではない。
// biome-ignore lint/suspicious/noControlCharactersInRegex: 端末の制御文字を扱う。
const OSC_RESPONSE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

// 端末への問い合わせ（OSC 11）。応答が上限の時間内に無ければundefined。
function queryBackground(io: TopIo): Promise<Rgb | undefined> {
	return new Promise((resolve) => {
		let buffer = "";
		const finish = (value: Rgb | undefined) => {
			stop();
			cancel();
			resolve(value);
		};
		const stop = io.onData((chunk) => {
			buffer += chunk;
			const rgb = parseOsc11(buffer);
			if (rgb) finish(rgb);
		});
		const cancel = io.setTimeout(() => finish(undefined), OSC_TIMEOUT_MS);
		io.write(OSC_BACKGROUND_QUERY);
	});
}

const matches = (row: TopRow, text: string): boolean =>
	[row.repository, row.branch, row.model, row.sessionId.slice(0, 8)]
		.join(" ")
		.toLowerCase()
		.includes(text.toLowerCase());

export async function runScreen(options: ScreenOptions): Promise<number> {
	const { io, args, settings } = options;
	let restored = false;
	// 何が起きても、alternate screen、cursor、入力の状態をもとに戻す。
	const restoreTerminal = () => {
		if (restored) return;
		restored = true;
		io.write(RESTORE);
		io.setRawMode(false);
		io.setPaused(true);
	};
	// raw modeにする前に登録し、問い合わせの途中で終わっても戻す。
	const stopExit = io.onProcessExit(restoreTerminal);
	io.setRawMode(true);
	io.setPaused(false);
	let background: Rgb | undefined;
	try {
		background =
			args.theme === "auto" && !isColorDisabled(options.env, io.colorDepth)
				? await queryBackground(io)
				: undefined;
	} catch (error) {
		restoreTerminal();
		stopExit();
		throw error;
	}
	const painter = createPainter({
		env: options.env,
		colorDepth: io.colorDepth,
		theme: args.theme,
		...(background ? { oscBackground: background } : {}),
	});

	let snapshot = options.first;
	let mode: Mode = "list";
	// 選択と詳細はsessionで覚える。更新で並びが入れ替わっても、別のsessionに飛ばない。
	let selectedId: string | undefined;
	let detailId: string | undefined;
	let filter: string | undefined;
	let typing = "";
	let sortIndex = 0;
	let paused = false;
	let refreshing = false;
	let finished = false;
	// 100msを過ぎて届いた応答の、閉じるまでの途中。
	let pendingOsc = "";
	const notices = () => [
		...(options.settingsNotice ? [options.settingsNotice] : []),
		...skippedNotice(snapshot),
	];

	const visible = (): TopRow[] => {
		const sort = SORTS[sortIndex] ?? SORTS[0];
		const text = mode === "filter" ? typing : filter;
		return snapshot.sessions
			.filter((row) => text === undefined || text === "" || matches(row, text))
			.sort((a, b) => sort.key(b) - sort.key(a));
	};

	// 選択しているsessionの行の番号。消えていれば先頭にする。
	const indexOfSelected = (rows: readonly TopRow[]): number => {
		const index = rows.findIndex((row) => row.sessionId === selectedId);
		return index >= 0 ? index : 0;
	};

	const select = (rows: readonly TopRow[], index: number) => {
		const clamped = Math.max(0, Math.min(index, rows.length - 1));
		selectedId = rows[clamped]?.sessionId;
	};

	const render = () => {
		const rows = visible();
		const index = indexOfSelected(rows);
		select(rows, index);
		const opts = {
			width: io.columns ?? DEFAULT_COLUMNS,
			ascii: args.ascii,
			ambiguousWide: settings.ambiguousWide,
			nowMs: options.now(),
			painter,
			selectedIndex: index,
			notices: notices(),
			paused,
			braille: settings.braille,
			sortLabel: (SORTS[sortIndex] ?? SORTS[0]).label,
			...(mode === "filter"
				? { filterText: `${typing}_` }
				: filter
					? { filterText: filter }
					: {}),
		};
		const detail = snapshot.sessions.find((r) => r.sessionId === detailId);
		// 詳細のsessionが24時間の窓から外れたら、一覧に戻る。
		if (mode === "detail" && !detail) mode = "list";
		const lines =
			mode === "help"
				? HELP_LINES
				: mode === "detail" && detail
					? renderDetail(detail, opts)
					: renderList(rows, opts);
		io.write(
			`${HOME}${lines.map((l) => l + CLEAR_LINE_END).join("\r\n")}${CLEAR_BELOW}`,
		);
	};

	const refresh = async () => {
		if (refreshing) return;
		refreshing = true;
		try {
			snapshot = await options.reader.refresh(options.now());
		} catch {
			// 読めなかったときは直前の表示を残す。
		}
		refreshing = false;
		if (!finished) render();
	};

	return new Promise<number>((resolve) => {
		const quit = () => {
			if (finished) return;
			finished = true;
			stopData();
			stopResize();
			stopExit();
			stopTimer();
			restoreTerminal();
			resolve(0);
		};

		const onKey = (key: string) => {
			if (key === "\x03") return quit();
			if (mode === "help") {
				mode = "list";
				return render();
			}
			if (mode === "filter") {
				if (key === "\r" || key === "\n") {
					filter = typing === "" ? undefined : typing;
					mode = "list";
				} else if (key === "\x1b") {
					filter = undefined;
					mode = "list";
				} else if (key === "\x7f" || key === "\b") {
					typing = typing.slice(0, -1);
				} else if (key >= " " && !key.startsWith("\x1b")) {
					typing += key;
				}
				selectedId = undefined;
				return render();
			}
			if (mode === "detail") {
				if (key === "\x1b" || key === "\r" || key === "\n") mode = "list";
				else if (key === "q") return quit();
				else if (key === "p") paused = !paused;
				else if (key === "r") return void refresh();
				return render();
			}
			const rows = visible();
			if (key === "q") return quit();
			if (key === "?") mode = "help";
			else if (key === "\x1b[A" || key === "\x1bOA" || key === "k")
				select(rows, indexOfSelected(rows) - 1);
			else if (key === "\x1b[B" || key === "\x1bOB" || key === "j")
				select(rows, indexOfSelected(rows) + 1);
			else if (key === "\r" || key === "\n") {
				const row = rows[indexOfSelected(rows)];
				if (row) {
					detailId = row.sessionId;
					mode = "detail";
				}
			} else if (key === "/") {
				mode = "filter";
				typing = "";
			} else if (key === "\x1b") filter = undefined;
			else if (key === "s") sortIndex = (sortIndex + 1) % SORTS.length;
			else if (key === "p") paused = !paused;
			else if (key === "r") return void refresh();
			render();
		};

		io.write(ENTER);
		const stopData = io.onData((chunk) => {
			// 問い合わせの応答が遅れて届いても、キーとして扱わない。
			let text = (pendingOsc + chunk).replace(OSC_RESPONSE, "");
			pendingOsc = "";
			const open = text.indexOf("\x1b]");
			if (open >= 0) {
				pendingOsc = text.slice(open);
				text = text.slice(0, open);
			}
			for (const key of text.match(KEYS) ?? []) onKey(key);
		});
		const stopResize = io.onResize(render);
		const stopTimer = io.setInterval(() => {
			if (!paused) void refresh();
		}, REFRESH_MS);
		render();
	});
}
