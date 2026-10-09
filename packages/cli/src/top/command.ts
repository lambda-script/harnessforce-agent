import { join } from "node:path";
import type { RunGit } from "@harnessforce/agent-core/process/git";
import { recordBase } from "../import/record-base.js";
import { parseTopArgs, TOP_USAGE } from "./args.js";
import { plainPainter, renderList, skippedNotice } from "./frame.js";
import { DEFAULT_COLUMNS, type TopIo } from "./io.js";
import { createTopReader, type TopRow } from "./reader.js";
import { runScreen } from "./screen.js";
import { sessionState } from "./session.js";
import { readTopSettings } from "./settings.js";

export type TopDeps = {
	homeDir: string;
	managedDir: string;
	env: Readonly<Record<string, string | undefined>>;
	stdout: (text: string) => void;
	stderr: (text: string) => void;
	// 現在の時刻（ミリ秒）。
	now: () => number;
	git: RunGit;
	top: TopIo;
};

const iso = (ms: number) => new Date(ms).toISOString();

// terminal-view.md「`--json`」: 取得できない値はnullとし、0にしない。本文は持たない。
function toJson(row: TopRow, nowMs: number) {
	return {
		session_id: row.sessionId.slice(0, 8),
		state: sessionState(row.lastEventAtMs, nowMs),
		repository: row.repository ?? null,
		branch: row.branch ?? null,
		model: row.model ?? null,
		started_at: iso(row.startedAtMs),
		last_event_at: iso(row.lastEventAtMs),
		tokens: row.tokens
			? {
					input: row.tokens.input,
					output: row.tokens.output,
					cache_read: row.tokens.cacheRead,
					cache_write: row.tokens.cacheWrite,
				}
			: null,
		context_tokens: row.contextTokens ?? null,
		tool_calls: row.toolCalls,
		tool_failures: row.toolFailures,
	};
}

export async function topCommand(
	args: readonly string[],
	deps: TopDeps,
): Promise<number> {
	const parsed = parseTopArgs(args);
	if (!parsed) {
		deps.stderr(TOP_USAGE);
		return 1;
	}
	const { settings, notice } = await readTopSettings(deps.homeDir);
	const reader = createTopReader({
		projectsDir: join(await recordBase(deps), "projects"),
		git: deps.git,
	});
	const snapshot = await reader.refresh(deps.now());
	if (parsed.json) {
		deps.stdout(
			`${JSON.stringify({ sessions: snapshot.sessions.map((r) => toJson(r, deps.now())) })}\n`,
		);
		return 0;
	}
	const interactive = deps.top.isTty && !parsed.once;
	if (interactive)
		return runScreen({
			args: parsed,
			settings,
			settingsNotice: notice,
			reader,
			first: snapshot,
			io: deps.top,
			env: deps.env,
			now: deps.now,
		});
	// escape、cursorの制御、alternate screenを出さない平文。色も使わない。
	const lines = renderList(snapshot.sessions, {
		width: deps.top.isTty
			? (deps.top.columns ?? DEFAULT_COLUMNS)
			: DEFAULT_COLUMNS,
		ascii: parsed.ascii,
		ambiguousWide: settings.ambiguousWide,
		nowMs: deps.now(),
		painter: plainPainter,
		selectedIndex: -1,
		notices: [...(notice ? [notice] : []), ...skippedNotice(snapshot)],
		paused: false,
	});
	deps.stdout(`${lines.join("\n")}\n`);
	return 0;
}
