import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { RunGit } from "@harnessforce/agent-core/process/git";
import { resolveRepository } from "@harnessforce/agent-core/vcs";
import type { SessionImport } from "@harnessforce/semconv";
import {
	CODEX_PARSER_VERSION,
	parseRollout,
	type RolloutSession,
} from "./rollout.js";
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

// 同じ入力からは同じ順で送り、途中で止まった後も同じsessionから続ける。
const sortedSessions = (sessions: ReadonlyMap<string, SessionImport>) =>
	[...sessions.values()].sort(
		(a, b) =>
			Date.parse(a.started_at) - Date.parse(b.started_at) ||
			(a.session_id < b.session_id ? -1 : a.session_id > b.session_id ? 1 : 0),
	);

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
		sessions: sortedSessions(sessions),
		skippedLines,
		skippedFiles,
	};
}

export type CodexScan = SessionScan & {
	// modelまたはtoken数を読めないsession（範囲とrepositoryの判定を通ったものだけ）。
	unextractable: number;
	// 範囲内の圧縮されたrollout（`.jsonl.zst`）。中は読まない。
	compressed: number;
};

type CodexScanOptions = {
	// Codexの記録の基点（`~/.codex`）。この下の`sessions/YYYY/MM/DD`を読む。
	codexDir: string;
	sinceMs: number;
	connected: ReadonlySet<string>;
	git: RunGit;
};

const numericName = (name: string, length: number) =>
	name.length === length && /^\d+$/.test(name) ? Number(name) : undefined;

const subdirectories = async (dir: string) =>
	(await readDir(dir)).filter((entry) => entry.isDirectory());

// correlation.md「Codexのrollout」: `sessions/YYYY/MM/DD/rollout-*.jsonl`だけを読み、圧縮されたfileは数えるだけにする。
async function listRollouts(sessionsDir: string, sinceDay: number) {
	const files: string[] = [];
	let compressed = 0;
	for (const year of await subdirectories(sessionsDir)) {
		for (const month of await subdirectories(join(sessionsDir, year.name))) {
			for (const day of await subdirectories(
				join(sessionsDir, year.name, month.name),
			)) {
				const dir = join(sessionsDir, year.name, month.name, day.name);
				const y = numericName(year.name, 4);
				const m = numericName(month.name, 2);
				const d = numericName(day.name, 2);
				const dayKey =
					y === undefined || m === undefined || d === undefined
						? undefined
						: y * 10_000 + m * 100 + d;
				for (const entry of await readDir(dir)) {
					if (!entry.isFile() || !entry.name.startsWith("rollout-")) continue;
					if (entry.name.endsWith(".jsonl")) files.push(join(dir, entry.name));
					else if (
						entry.name.endsWith(".jsonl.zst") &&
						dayKey !== undefined &&
						dayKey >= sinceDay
					)
						compressed += 1;
				}
			}
		}
	}
	return { files, compressed };
}

// 端末のtimezoneの暦日をYYYYMMDDの整数にする。
const localDayKey = (ms: number) => {
	const date = new Date(ms);
	return (
		date.getFullYear() * 10_000 + (date.getMonth() + 1) * 100 + date.getDate()
	);
};

export function toCodexSessionImport(
	session: RolloutSession,
	repository: string,
): SessionImport {
	return {
		agent: "codex",
		source: "import",
		session_id: session.sessionId,
		repository,
		...(session.branch ? { branch: session.branch } : {}),
		...(session.commit ? { commit: session.commit } : {}),
		started_at: session.startedAt,
		ended_at: session.endedAt,
		model: session.model,
		input_tokens: session.inputTokens,
		output_tokens: session.outputTokens,
		// rolloutには呼び出しの成否がすべての種類について保存されないため、failuresは省略する。
		tool_calls: session.toolCalls.map(({ tool, calls }) => ({ tool, calls })),
		parser_version: CODEX_PARSER_VERSION,
	};
}

// correlation.md「Codexのrollout」: 範囲内に終わり、cwdのrepositoryが接続済みのsessionだけを返す。
export async function scanCodexSessions(
	options: CodexScanOptions,
): Promise<CodexScan> {
	const repositories = new Map<string, Promise<string | undefined>>();
	const repositoryOf = (cwd: string) => {
		const cached = repositories.get(cwd) ?? resolveRepository(cwd, options.git);
		repositories.set(cwd, cached);
		return cached;
	};
	const isSent = async (cwd: string | undefined) => {
		if (!cwd) return undefined;
		const repository = await repositoryOf(cwd);
		return repository !== undefined && options.connected.has(repository)
			? repository
			: undefined;
	};
	const { files, compressed } = await listRollouts(
		join(options.codexDir, "sessions"),
		localDayKey(options.sinceMs),
	);
	const sessions = new Map<string, SessionImport>();
	let skippedLines = 0;
	let skippedFiles = 0;
	let unextractable = 0;
	for (const file of files) {
		const modifiedMs = (await stat(file).catch(() => undefined))?.mtimeMs;
		if (modifiedMs !== undefined && modifiedMs < options.sinceMs) continue;
		const result = await parseRollout(file);
		skippedLines += result.skippedLines;
		if (result.kind === "unreadable") skippedFiles += 1;
		if (result.kind === "unextractable") {
			if (
				Date.parse(result.endedAt) >= options.sinceMs &&
				(await isSent(result.cwd))
			)
				unextractable += 1;
			continue;
		}
		if (result.kind !== "session") continue;
		const { session } = result;
		if (Date.parse(session.endedAt) < options.sinceMs) continue;
		const repository = await isSent(session.cwd);
		if (repository === undefined) continue;
		if (!sessions.has(session.sessionId))
			sessions.set(
				session.sessionId,
				toCodexSessionImport(session, repository),
			);
	}
	return {
		sessions: sortedSessions(sessions),
		skippedLines,
		skippedFiles,
		unextractable,
		compressed,
	};
}
