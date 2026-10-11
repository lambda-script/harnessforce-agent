import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { isObject } from "@harnessforce/agent-core/object";
import {
	isToken,
	MAX_MODEL,
	MAX_TOOL_NAME,
	toInstantMs,
	tokens,
} from "../top/session.js";

// correlation.md「Codexのrollout」の取り出し方を変えたらこのversionを上げ、送るsessionにparser_versionとして付ける。
export const CODEX_PARSER_VERSION = "1.0.0";

const DETACHED = "HEAD";
const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
// local_shell_callは名前の項目を持たないため、この規則が定める名前を使う。
const SHELL = "shell";
const NAMED_CALLS = new Set(["function_call", "custom_tool_call"]);

// 取り出すのは送る項目の元になる値だけで、指示、応答、toolの入力と出力の本文は読んでも持たない。
export type RolloutSession = {
	sessionId: string;
	cwd?: string;
	branch?: string;
	commit?: string;
	startedAt: string;
	endedAt: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
	toolCalls: { tool: string; calls: number }[];
};

export type RolloutResult =
	| { kind: "session"; session: RolloutSession; skippedLines: number }
	// token_countもturn_contextも持たない（応答の前に終わった）session。表示しない。
	| { kind: "incomplete"; skippedLines: number }
	// modelまたはtotal_token_usageを取り出せないsession。件数を表示する。
	// 範囲とrepositoryの判定に使うため、終了の時刻とcwdを持つ。
	| {
			kind: "unextractable";
			skippedLines: number;
			endedAt: string;
			cwd?: string;
	  }
	| { kind: "unreadable"; skippedLines: number };

type Row = Record<string, unknown>;

class Accumulator {
	sessionId: string | undefined;
	private cwd: string | undefined;
	private branch: string | undefined;
	private commit: string | undefined;
	private firstMs = Number.POSITIVE_INFINITY;
	private lastMs = Number.NEGATIVE_INFINITY;
	private input: number | undefined;
	private output: number | undefined;
	private sawResponse = false;
	// modelごとの数と、最後に現れた順（同数なら最後に現れたmodelを選ぶ）。
	private readonly models = new Map<string, { count: number; last: number }>();
	private turnIndex = 0;
	private readonly tools = new Map<string, number>();

	add(row: Row): void {
		const ms = toInstantMs(row.timestamp);
		if (ms !== undefined) {
			this.firstMs = Math.min(this.firstMs, ms);
			this.lastMs = Math.max(this.lastMs, ms);
		}
		const payload = isObject(row.payload) ? row.payload : undefined;
		if (!payload) return;
		switch (row.type) {
			case "session_meta":
				this.addMeta(payload);
				break;
			case "turn_context":
				this.addTurn(payload);
				break;
			case "response_item":
				this.addCall(payload);
				break;
			case "event_msg":
				if (payload.type === "token_count") this.addTokenCount(payload);
				break;
		}
	}

	private addMeta(payload: Row): void {
		if (this.sessionId !== undefined || !isToken(payload.id, 256)) return;
		this.sessionId = payload.id;
		if (typeof payload.cwd === "string") this.cwd = payload.cwd;
		const git = isObject(payload.git) ? payload.git : {};
		if (isToken(git.branch, 256) && git.branch !== DETACHED)
			this.branch = git.branch;
		if (typeof git.commit_hash === "string" && COMMIT_SHA.test(git.commit_hash))
			this.commit = git.commit_hash;
	}

	private addTurn(payload: Row): void {
		this.sawResponse = true;
		if (!isToken(payload.model, MAX_MODEL)) return;
		this.turnIndex += 1;
		const known = this.models.get(payload.model);
		this.models.set(payload.model, {
			count: (known?.count ?? 0) + 1,
			last: this.turnIndex,
		});
	}

	private addCall(payload: Row): void {
		const name =
			payload.type === "local_shell_call"
				? SHELL
				: NAMED_CALLS.has(String(payload.type)) &&
						isToken(payload.name, MAX_TOOL_NAME)
					? payload.name
					: undefined;
		if (name !== undefined)
			this.tools.set(name, (this.tools.get(name) ?? 0) + 1);
	}

	private addTokenCount(payload: Row): void {
		this.sawResponse = true;
		if (!isObject(payload.info) || !isObject(payload.info.total_token_usage))
			return;
		const total = payload.info.total_token_usage;
		const input = tokens(total.input_tokens);
		const output = tokens(total.output_tokens);
		if (input === undefined || output === undefined) return;
		// 入力はcache readを含むため引く。cache writeは含まれないものとして引かず、reasoningは足さない。
		this.input = Math.max(0, input - (tokens(total.cached_input_tokens) ?? 0));
		this.output = output;
	}

	result(skippedLines: number): RolloutResult {
		if (this.sessionId === undefined || !Number.isFinite(this.firstMs))
			return { kind: "unreadable", skippedLines };
		if (!this.sawResponse) return { kind: "incomplete", skippedLines };
		const [model] = [...this.models].sort(
			([, a], [, b]) => b.count - a.count || b.last - a.last,
		)[0] ?? [undefined];
		if (
			model === undefined ||
			this.input === undefined ||
			this.output === undefined
		)
			return {
				kind: "unextractable",
				skippedLines,
				endedAt: new Date(this.lastMs).toISOString(),
				...(this.cwd ? { cwd: this.cwd } : {}),
			};
		return {
			kind: "session",
			skippedLines,
			session: {
				sessionId: this.sessionId,
				...(this.cwd ? { cwd: this.cwd } : {}),
				...(this.branch ? { branch: this.branch } : {}),
				...(this.commit ? { commit: this.commit } : {}),
				startedAt: new Date(this.firstMs).toISOString(),
				endedAt: new Date(this.lastMs).toISOString(),
				model,
				inputTokens: this.input,
				outputTokens: this.output,
				toolCalls: [...this.tools]
					.map(([tool, calls]) => ({ tool, calls }))
					.sort((a, b) => (a.tool < b.tool ? -1 : a.tool > b.tool ? 1 : 0)),
			},
		};
	}
}

// JSONのobjectでない行は読み飛ばして数える。知らない`type`の行は数えない。
export async function parseRollout(path: string): Promise<RolloutResult> {
	const accumulator = new Accumulator();
	let skippedLines = 0;
	try {
		const lines = createInterface({
			input: createReadStream(path, { encoding: "utf8" }),
			crlfDelay: Number.POSITIVE_INFINITY,
		});
		for await (const text of lines) {
			if (text.trim() === "") continue;
			let value: unknown;
			try {
				value = JSON.parse(text);
			} catch {
				skippedLines += 1;
				continue;
			}
			if (!isObject(value)) skippedLines += 1;
			else accumulator.add(value);
		}
	} catch {
		return { kind: "unreadable", skippedLines };
	}
	return accumulator.result(skippedLines);
}
