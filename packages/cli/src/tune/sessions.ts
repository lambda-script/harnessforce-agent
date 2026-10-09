import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { RunGit } from "@harnessforce/agent-core/process/git";
import { resolveRepository } from "@harnessforce/agent-core/vcs";
import { listTranscripts } from "../import/sessions.js";
import {
	parseTranscriptEvents,
	parseTranscriptUsage,
	type TranscriptEvent,
	type TranscriptSession,
	type TranscriptUsage,
} from "../import/transcript.js";
import { type SessionUsage, summarizeUsage } from "./usage.js";

export type TuneSession = {
	session: TranscriptSession;
	events: TranscriptEvent[];
	transcriptPath: string;
	// 正規化した`<host>/<owner>/<name>`。gitのrepositoryの外やremoteの無いcwdはnull。
	repository: string | null;
	usage: SessionUsage;
	lines: number;
	skippedLines: number;
};

type ReadOptions = {
	projectsDir: string;
	// これより前に最後に書かれたfileは読まない（開始もそれより前にある）。undefinedならすべて読む。
	modifiedSinceMs: number | undefined;
	git: RunGit;
};

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// improvement-loop.md「端末だけの値」: subagentの記録は本体の`<session>.jsonl`の隣の`<session>/subagents/*.jsonl`。
// directoryが無ければsubagentは無い。directoryかfileを読めなければnull（0と区別する）。
async function readSubagentUsages(
	transcriptPath: string,
): Promise<TranscriptUsage[] | null> {
	const dir = join(
		dirname(transcriptPath),
		basename(transcriptPath, ".jsonl"),
		"subagents",
	);
	let names: string[];
	try {
		names = await readdir(dir);
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT" ? [] : null;
	}
	const usages: TranscriptUsage[] = [];
	for (const name of names.filter((n) => n.endsWith(".jsonl")).sort()) {
		const usage = await parseTranscriptUsage(join(dir, name));
		if (usage === undefined) return null;
		usages.push(usage);
	}
	return usages;
}

// improvement-loop.md「読むもの」: harnessforce importと同じ場所と読み込み処理でsessionを読む。
// 同じsession IDのfileが複数あれば、path順で最初のfileを使う。
export async function readTuneSessions(
	options: ReadOptions,
): Promise<TuneSession[]> {
	const repositories = new Map<string, Promise<string | undefined>>();
	const repositoryOf = (cwd: string) => {
		const cached = repositories.get(cwd) ?? resolveRepository(cwd, options.git);
		repositories.set(cwd, cached);
		return cached;
	};
	const sessions = new Map<string, TuneSession>();
	const files = (await listTranscripts(options.projectsDir)).sort(byCodeUnit);
	for (const file of files) {
		if (options.modifiedSinceMs !== undefined) {
			const modifiedMs = (await stat(file).catch(() => undefined))?.mtimeMs;
			if (modifiedMs !== undefined && modifiedMs < options.modifiedSinceMs)
				continue;
		}
		const result = await parseTranscriptEvents(file);
		if (result.kind !== "session") continue;
		const { session } = result;
		if (sessions.has(session.sessionId)) continue;
		const repository = session.cwd
			? ((await repositoryOf(session.cwd)) ?? null)
			: null;
		sessions.set(session.sessionId, {
			session,
			events: result.events,
			transcriptPath: file,
			repository,
			usage: summarizeUsage(result.usage, await readSubagentUsages(file)),
			lines: result.lines,
			skippedLines: result.skippedLines,
		});
	}
	return [...sessions.values()].sort(
		(a, b) =>
			Date.parse(a.session.startedAt) - Date.parse(b.session.startedAt) ||
			byCodeUnit(a.session.sessionId, b.session.sessionId),
	);
}
