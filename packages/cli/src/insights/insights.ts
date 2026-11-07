import { runUntilStop, stopWith } from "../shared/stop.js";
import { clearInsightsFiles } from "./clear.js";
import {
	type AnalyzeOptions,
	analyzeCommand,
	type InsightsDeps,
} from "./command.js";
import { acquireInsightsLock } from "./lock.js";
import { INSIGHTS_MESSAGES } from "./messages.js";
import {
	MAX_RECORD_INPUT_BYTES,
	RecordInputError,
	RecordWriteError,
	recordProposal,
} from "./record.js";
import { ensureDir, insightsPaths } from "./store.js";

export type InsightsCommandDeps = InsightsDeps & {
	// stdinを最大maxBytes+1 byteまで読む。
	readStdin: (maxBytes: number) => Promise<Buffer>;
	// 実行中の`harnessforce`の絶対path。`schedule`の行のcommandに使う。
	selfPath: string;
};

const FLAGS = {
	"--all": "all",
	"--no-send": "noSend",
	"--show-report": "showReport",
	"--json": "json",
	"--quiet": "quiet",
} as const;

type Parsed =
	| { kind: "analyze"; options: AnalyzeOptions }
	| { kind: "record" }
	| { kind: "clear" }
	| { kind: "schedule" };

const QUIET = "--quiet";

function parseArgs(args: readonly string[]): Parsed | undefined {
	if (args.length === 1 && args[0] === "record") return { kind: "record" };
	if (args.length === 1 && args[0] === "clear") return { kind: "clear" };
	if (args.length === 1 && args[0] === "schedule") return { kind: "schedule" };
	const options: AnalyzeOptions = {
		all: false,
		noSend: false,
		showReport: false,
		json: false,
		quiet: false,
	};
	for (const arg of args) {
		const key = FLAGS[arg as keyof typeof FLAGS];
		if (key === undefined || options[key]) return undefined;
		options[key] = true;
	}
	// `--quiet`は`--all`とだけ組み合わせられる。
	if (options.quiet && (options.noSend || options.showReport || options.json))
		return undefined;
	return { kind: "analyze", options };
}

// cronはcommandを`/bin/sh`へ渡し、`%`を改行として扱う。shellが分けたり展開したりする文字を含むpathは引用する。
function cronCommandPath(path: string): string {
	const quoted = /^[A-Za-z0-9_./-]+$/.test(path)
		? path
		: `'${path.replaceAll("'", "'\\''")}'`;
	return quoted.replaceAll("%", "\\%");
}

// improvement-loop.md「操作」: 毎週月曜日の端末のtimezoneの9時に`--quiet`を起動するcronの1行。何も書き換えず、通信しない。
const scheduleLine = (selfPath: string) =>
	`0 9 * * 1 ${cronCommandPath(selfPath)} insights ${QUIET}\n`;

// tokenとkeyを送りうるのは`--no-send`を付けない分析だけ。`record`、`clear`、`schedule`、`--no-send`を付けた分析、誤った引数は通信を行わない。
export function canInsightsSend(args: readonly string[]): boolean {
	const parsed = parseArgs(args);
	return parsed?.kind === "analyze" && !parsed.options.noSend;
}

// improvement-loop.md「`harnessforce insights`」の`record`と`clear`: keychainと宛先を読まず、ネットワークを使わない。
async function underLock(
	deps: InsightsCommandDeps,
	failure: string,
	body: (paths: ReturnType<typeof insightsPaths>) => Promise<number>,
): Promise<number> {
	return runUntilStop(async () => {
		const paths = insightsPaths(deps.homeDir);
		await ensureDir(paths.dir).catch(() => stopWith(failure));
		const release = await acquireInsightsLock(paths.lock, deps).catch(() =>
			stopWith(failure),
		);
		if (!release) return stopWith(INSIGHTS_MESSAGES.locked);
		try {
			return await body(paths);
		} finally {
			await release();
		}
	}, deps.stderr);
}

async function record(deps: InsightsCommandDeps): Promise<number> {
	const input = await deps.readStdin(MAX_RECORD_INPUT_BYTES);
	const invalid = (field: string) => {
		deps.stderr(`${INSIGHTS_MESSAGES.recordInvalid(field)}\n`);
		return 2;
	};
	if (input.length > MAX_RECORD_INPUT_BYTES) return invalid("input");
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(input);
	} catch {
		return invalid("input");
	}
	return underLock(deps, INSIGHTS_MESSAGES.recordFailed, async (paths) => {
		try {
			const result = await recordProposal(text, paths, deps.now);
			deps.stdout(`${JSON.stringify(result)}\n`);
			return 0;
		} catch (error) {
			if (error instanceof RecordInputError) return invalid(error.field);
			if (error instanceof RecordWriteError)
				return stopWith(INSIGHTS_MESSAGES.recordFailed);
			throw error;
		}
	});
}

export async function insightsCommand(
	args: readonly string[],
	deps: InsightsCommandDeps,
): Promise<number> {
	const parsed = parseArgs(args);
	if (!parsed) {
		deps.stderr(`${INSIGHTS_MESSAGES.usage}\n`);
		return 2;
	}
	if (parsed.kind === "record") return record(deps);
	if (parsed.kind === "schedule") {
		deps.stdout(scheduleLine(deps.selfPath));
		return 0;
	}
	if (parsed.kind === "clear")
		return underLock(deps, INSIGHTS_MESSAGES.clearFailed, async (paths) => {
			if (!(await clearInsightsFiles(paths)))
				return stopWith(INSIGHTS_MESSAGES.clearFailed);
			deps.stderr(`${INSIGHTS_MESSAGES.cleared}\n`);
			return 0;
		});
	return analyzeCommand(parsed.options, deps);
}
