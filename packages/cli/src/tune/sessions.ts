import { stat } from "node:fs/promises";
import type { RunGit } from "@harnessforce/agent-core/process/git";
import { resolveRepository } from "@harnessforce/agent-core/vcs";
import { listTranscripts } from "../import/sessions.js";
import {
	parseTranscriptEvents,
	type TranscriptEvent,
	type TranscriptSession,
} from "../import/transcript.js";

export type TuneSession = {
	session: TranscriptSession;
	events: TranscriptEvent[];
	transcriptPath: string;
	// 正規化した`<host>/<owner>/<name>`。gitのrepositoryの外やremoteの無いcwdはnull。
	repository: string | null;
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

// improvement-loop.md「読むもの」: hf importと同じ場所と読み込み処理でsessionを読む。
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
