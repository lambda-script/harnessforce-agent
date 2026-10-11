import { runUntilStop, stopWith } from "../shared/stop.js";
import {
	type AnalyzeOptions,
	analyzeCommand,
	type TuneDeps,
} from "./command.js";
import { acquireTuneLock } from "./lock.js";
import { TUNE_MESSAGES } from "./messages.js";
import { purgeTuneFiles } from "./purge.js";
import {
	MAX_RECORD_INPUT_BYTES,
	RecordInputError,
	RecordWriteError,
	recordProposal,
} from "./record.js";
import { ensureDir, tunePaths } from "./store.js";

export type TuneCommandDeps = TuneDeps & {
	// stdinを最大maxBytes+1 byteまで読む。
	readStdin: (maxBytes: number) => Promise<Buffer>;
};

const FLAGS = {
	"--all": "all",
	"--no-send": "noSend",
	"--show-report": "showReport",
	"--json": "json",
} as const;

type Parsed =
	| { kind: "analyze"; options: AnalyzeOptions }
	| { kind: "record" }
	| { kind: "purge" };

function parseArgs(args: readonly string[]): Parsed | undefined {
	if (args.length === 1 && args[0] === "record") return { kind: "record" };
	if (args.length === 1 && args[0] === "--purge") return { kind: "purge" };
	const options: AnalyzeOptions = {
		all: false,
		noSend: false,
		showReport: false,
		json: false,
	};
	for (const arg of args) {
		const key = FLAGS[arg as keyof typeof FLAGS];
		if (key === undefined || options[key]) return undefined;
		options[key] = true;
	}
	return { kind: "analyze", options };
}

// improvement-loop.md「`harnessforce tune`」の`record`と`--purge`: keychainと宛先を読まず、ネットワークを使わない。
async function underLock(
	deps: TuneCommandDeps,
	failure: string,
	body: (paths: ReturnType<typeof tunePaths>) => Promise<number>,
): Promise<number> {
	return runUntilStop(async () => {
		const paths = tunePaths(deps.homeDir);
		await ensureDir(paths.dir).catch(() => stopWith(failure));
		const release = await acquireTuneLock(paths.lock, deps).catch(() =>
			stopWith(failure),
		);
		if (!release) return stopWith(TUNE_MESSAGES.locked);
		try {
			return await body(paths);
		} finally {
			await release();
		}
	}, deps.stderr);
}

async function record(deps: TuneCommandDeps): Promise<number> {
	const input = await deps.readStdin(MAX_RECORD_INPUT_BYTES);
	const invalid = (field: string) => {
		deps.stderr(`${TUNE_MESSAGES.recordInvalid(field)}\n`);
		return 2;
	};
	if (input.length > MAX_RECORD_INPUT_BYTES) return invalid("input");
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(input);
	} catch {
		return invalid("input");
	}
	return underLock(deps, TUNE_MESSAGES.recordFailed, async (paths) => {
		try {
			const result = await recordProposal(text, paths, deps.now);
			deps.stdout(`${JSON.stringify(result)}\n`);
			return 0;
		} catch (error) {
			if (error instanceof RecordInputError) return invalid(error.field);
			if (error instanceof RecordWriteError)
				return stopWith(TUNE_MESSAGES.recordFailed);
			throw error;
		}
	});
}

export async function tuneCommand(
	args: readonly string[],
	deps: TuneCommandDeps,
): Promise<number> {
	const parsed = parseArgs(args);
	if (!parsed) {
		deps.stderr(`${TUNE_MESSAGES.usage}\n`);
		return 2;
	}
	if (parsed.kind === "record") return record(deps);
	if (parsed.kind === "purge")
		return underLock(deps, TUNE_MESSAGES.purgeFailed, async (paths) => {
			if (!(await purgeTuneFiles(paths)))
				return stopWith(TUNE_MESSAGES.purgeFailed);
			deps.stderr(`${TUNE_MESSAGES.purged}\n`);
			return 0;
		});
	return analyzeCommand(parsed.options, deps);
}
