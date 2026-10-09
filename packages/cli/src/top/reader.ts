import { open, stat } from "node:fs/promises";
import { isObject } from "@harnessforce/agent-core/object";
import type { RunGit } from "@harnessforce/agent-core/process/git";
import { resolveRepository } from "@harnessforce/agent-core/vcs";
import { listTranscripts } from "../import/sessions.js";
import { SessionAccumulator, type TopSession } from "./session.js";

// terminal-view.md「読むもの」: 最後のeventがこの時間以内のsessionだけを対象にする。
const WINDOW_MS = 24 * 60 * 60 * 1000;

export type TopRow = TopSession & {
	// 正規化した`<host>/<owner>/<name>`。求められなければundefined（空欄）。
	repository?: string;
};

export type TopSnapshot = {
	sessions: TopRow[];
	skippedLines: number;
	skippedFiles: number;
};

type FileState = {
	// 読み終えたbyteの位置。
	offset: number;
	accumulator: SessionAccumulator;
	skippedLines: number;
	unreadable: boolean;
};

type ReaderOptions = {
	// Claude Codeのconfigの基点の`projects`。
	projectsDir: string;
	git: RunGit;
};

const freshState = (): FileState => ({
	offset: 0,
	accumulator: new SessionAccumulator(),
	skippedLines: 0,
	unreadable: false,
});

// 改行までそろった行だけを渡す。
function feed(state: FileState, text: string): void {
	for (const raw of text.split("\n")) {
		const lineText = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
		if (lineText === "") continue;
		let row: unknown;
		try {
			row = JSON.parse(lineText);
		} catch {
			state.skippedLines += 1;
			continue;
		}
		if (isObject(row)) state.accumulator.add(row);
		else state.skippedLines += 1;
	}
}

// 巨大なtranscriptを一度にmemoryへ載せないよう、このbyteずつ読む。
const CHUNK_BYTES = 1024 * 1024;

// 追記された部分だけを読む。fileが短くなっていれば別のfileに置き換わったものとして最初から読む。
// 改行まで届いていない末尾の行は、offsetを進めずに次の読み込みで読み直す。
async function readAppended(
	path: string,
	state: FileState,
): Promise<FileState> {
	let size: number;
	try {
		size = (await stat(path)).size;
	} catch {
		return { ...state, unreadable: true };
	}
	const next = size < state.offset ? freshState() : state;
	if (size === next.offset) return { ...next, unreadable: false };
	try {
		const handle = await open(path, "r");
		try {
			let position = next.offset;
			let rest: Buffer = Buffer.alloc(0);
			while (position < size) {
				const chunk = Buffer.alloc(Math.min(CHUNK_BYTES, size - position));
				const { bytesRead } = await handle.read(
					chunk,
					0,
					chunk.length,
					position,
				);
				if (bytesRead === 0) break;
				position += bytesRead;
				const combined = Buffer.concat([rest, chunk.subarray(0, bytesRead)]);
				const end = combined.lastIndexOf(0x0a) + 1;
				if (end > 0) {
					feed(next, combined.subarray(0, end).toString("utf8"));
					next.offset += end;
				}
				rest = combined.subarray(end);
			}
			return { ...next, unreadable: false };
		} finally {
			await handle.close();
		}
	} catch {
		return { ...next, unreadable: true };
	}
}

export function createTopReader({ projectsDir, git }: ReaderOptions) {
	const files = new Map<string, FileState>();
	const repositories = new Map<string, Promise<string | undefined>>();
	const repositoryOf = (cwd: string) => {
		const cached = repositories.get(cwd) ?? resolveRepository(cwd, git);
		repositories.set(cwd, cached);
		return cached;
	};

	return {
		async refresh(nowMs: number): Promise<TopSnapshot> {
			const sessions = new Map<string, TopRow>();
			let skippedLines = 0;
			let skippedFiles = 0;
			for (const path of await listTranscripts(projectsDir)) {
				// 最後に書かれた時刻が範囲より前なら、最後のeventも範囲より前にある。
				const modifiedMs = (await stat(path).catch(() => undefined))?.mtimeMs;
				if (modifiedMs !== undefined && modifiedMs < nowMs - WINDOW_MS)
					continue;
				const state = await readAppended(path, files.get(path) ?? freshState());
				files.set(path, state);
				skippedLines += state.skippedLines;
				if (state.unreadable) skippedFiles += 1;
				const session = state.accumulator.result();
				if (!session || session.lastEventAtMs < nowMs - WINDOW_MS) continue;
				const existing = sessions.get(session.sessionId);
				if (existing && existing.lastEventAtMs >= session.lastEventAtMs)
					continue;
				const repository = session.cwd
					? await repositoryOf(session.cwd)
					: undefined;
				sessions.set(session.sessionId, {
					...session,
					...(repository === undefined ? {} : { repository }),
				});
			}
			return {
				sessions: [...sessions.values()].sort(
					(a, b) =>
						b.lastEventAtMs - a.lastEventAtMs ||
						(a.sessionId < b.sessionId
							? -1
							: a.sessionId > b.sessionId
								? 1
								: 0),
				),
				skippedLines,
				skippedFiles,
			};
		},
	};
}
