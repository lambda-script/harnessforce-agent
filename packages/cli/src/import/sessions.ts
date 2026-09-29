import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { RunGit } from "@harnessforce/agent-core/process/git";
import { resolveRepository } from "@harnessforce/agent-core/vcs";
import type { SessionImport } from "@harnessforce/semconv";
import {
	PARSER_VERSION,
	parseTranscript,
	type TranscriptSession,
} from "./transcript.js";

export type SessionScan = {
	sessions: SessionImport[];
	skippedLines: number;
	skippedFiles: number;
};

type ScanOptions = {
	// Claude Codeのconfigの基点の`projects`。
	projectsDir: string;
	// これより前に終わったsessionは取り込まない（session_import_days）。
	sinceMs: number;
	// Workspaceに接続済みのrepository（正規化した`<host>/<owner>/<name>`）。
	connected: ReadonlySet<string>;
	git: RunGit;
};

const readDir = (dir: string): Promise<Dirent[]> =>
	readdir(dir, { withFileTypes: true }).catch(() => []);

// claude-code.mdに記載された`<project>/<session>.jsonl`だけを読む。subagentなどの他の階層は読まない。
export async function listTranscripts(projectsDir: string): Promise<string[]> {
	const projects = (await readDir(projectsDir)).filter((entry) =>
		entry.isDirectory(),
	);
	const files = await Promise.all(
		projects.map(async (project) => {
			const dir = join(projectsDir, project.name);
			return (await readDir(dir))
				.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
				.map((entry) => join(dir, entry.name));
		}),
	);
	return files.flat();
}

export function toSessionImport(
	session: TranscriptSession,
	repository: string,
): SessionImport {
	return {
		agent: "claude_code",
		source: "import",
		session_id: session.sessionId,
		...(session.firstPromptId
			? { first_prompt_id: session.firstPromptId }
			: {}),
		repository,
		...(session.branch ? { branch: session.branch } : {}),
		started_at: session.startedAt,
		ended_at: session.endedAt,
		model: session.model,
		input_tokens: session.inputTokens,
		output_tokens: session.outputTokens,
		tool_calls: session.toolCalls,
		parser_version: PARSER_VERSION,
	};
}

// correlation.md「session import」: 範囲内に終わり、cwdのrepositoryが接続済みのsessionだけを返す。
// gitのrepositoryの外のsessionと、一致しないsessionは返さない（端末から送らない）。
export async function scanSessions(options: ScanOptions): Promise<SessionScan> {
	const repositories = new Map<string, Promise<string | undefined>>();
	const repositoryOf = (cwd: string) => {
		const cached = repositories.get(cwd) ?? resolveRepository(cwd, options.git);
		repositories.set(cwd, cached);
		return cached;
	};
	const sessions = new Map<string, SessionImport>();
	let skippedLines = 0;
	let skippedFiles = 0;
	for (const file of await listTranscripts(options.projectsDir)) {
		// 最後に書かれた時刻が範囲より前なら、最後の記録も範囲より前にある。
		const modifiedMs = (await stat(file).catch(() => undefined))?.mtimeMs;
		if (modifiedMs !== undefined && modifiedMs < options.sinceMs) continue;
		const result = await parseTranscript(file);
		skippedLines += result.skippedLines;
		if (result.kind === "unreadable") skippedFiles += 1;
		if (result.kind !== "session") continue;
		const { session } = result;
		if (Date.parse(session.endedAt) < options.sinceMs || !session.cwd) continue;
		const repository = await repositoryOf(session.cwd);
		if (repository === undefined || !options.connected.has(repository))
			continue;
		if (!sessions.has(session.sessionId))
			sessions.set(session.sessionId, toSessionImport(session, repository));
	}
	return {
		// 同じ入力からは同じ順で送り、途中で止まった後も同じsessionから続ける。
		sessions: [...sessions.values()].sort(
			(a, b) =>
				Date.parse(a.started_at) - Date.parse(b.started_at) ||
				(a.session_id < b.session_id
					? -1
					: a.session_id > b.session_id
						? 1
						: 0),
		),
		skippedLines,
		skippedFiles,
	};
}
