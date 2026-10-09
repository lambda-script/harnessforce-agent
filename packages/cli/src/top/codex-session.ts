import { isObject } from "@harnessforce/agent-core/object";
import {
	HOUR_MS,
	isToken,
	MAX_MODEL,
	MAX_TOOL_NAME,
	type TokenCounts,
	type ToolSummary,
	type TopSession,
	toInstantMs,
	tokens,
} from "./session.js";

// 詳細はdocs/references/codex-rollout.md（Codexのsessionの記録）と、terminal-view.md「行」の取り出し方の表。
const DETACHED = "HEAD";
// local_shell_callは名前の項目を持たない。
const SHELL = "shell";
const COUNTED_CALLS = new Set(["function_call", "custom_tool_call"]);

type Row = Record<string, unknown>;
type Usage = { input: number; cached: number; write: number; output: number };

function readUsage(value: unknown): Usage | undefined {
	if (!isObject(value)) return undefined;
	const input = tokens(value.input_tokens);
	const output = tokens(value.output_tokens);
	if (input === undefined || output === undefined) return undefined;
	return {
		input,
		output,
		cached: tokens(value.cached_input_tokens) ?? 0,
		write: tokens(value.cache_write_input_tokens) ?? 0,
	};
}

// 入力はcache readを含むため引く。cache writeは入力に含まれないものとして扱う。
const inputOf = (u: Usage) => Math.max(0, u.input - u.cached);

// prompt、response、toolの入力と出力は読んでも持たない（terminal-view.md「守ること」）。
export class CodexSessionAccumulator {
	private sessionId: string | undefined;
	private cwd: string | undefined;
	private branch: string | undefined;
	private model: string | undefined;
	private firstMs = Number.POSITIVE_INFINITY;
	private lastMs = Number.NEGATIVE_INFINITY;
	private total: TokenCounts | undefined;
	private contextTokens: number | undefined;
	private previousSum = 0;
	private readonly toolCounts = new Map<string, number>();
	private readonly modelTurns = new Map<string, number>();
	private readonly hours = new Map<number, number>();

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
				if (payload.type === "token_count") this.addTokenCount(payload, ms);
				break;
		}
	}

	private addMeta(payload: Row): void {
		if (this.sessionId !== undefined) return;
		if (!isToken(payload.id, 256)) return;
		this.sessionId = payload.id;
		if (typeof payload.cwd === "string") this.cwd = payload.cwd;
		const git = isObject(payload.git) ? payload.git : {};
		if (isToken(git.branch, 256) && git.branch !== DETACHED)
			this.branch = git.branch;
	}

	private addTurn(payload: Row): void {
		if (!isToken(payload.model, MAX_MODEL)) return;
		this.model = payload.model;
		this.modelTurns.set(
			payload.model,
			(this.modelTurns.get(payload.model) ?? 0) + 1,
		);
	}

	private addCall(payload: Row): void {
		const name =
			payload.type === "local_shell_call"
				? SHELL
				: COUNTED_CALLS.has(String(payload.type)) &&
						isToken(payload.name, MAX_TOOL_NAME)
					? payload.name
					: undefined;
		if (name !== undefined)
			this.toolCounts.set(name, (this.toolCounts.get(name) ?? 0) + 1);
	}

	private addTokenCount(payload: Row, ms: number | undefined): void {
		if (!isObject(payload.info)) return;
		const total = readUsage(payload.info.total_token_usage);
		if (!total) return;
		this.total = {
			input: inputOf(total),
			output: total.output,
			cacheRead: total.cached,
			cacheWrite: total.write,
		};
		const last = readUsage(payload.info.last_token_usage);
		this.contextTokens = last ? last.input + last.write : undefined;
		const sum = inputOf(total) + total.output;
		if (ms !== undefined) {
			const hour = Math.floor(ms / HOUR_MS) * HOUR_MS;
			this.hours.set(
				hour,
				(this.hours.get(hour) ?? 0) + Math.max(0, sum - this.previousSum),
			);
		}
		this.previousSum = sum;
	}

	result(): TopSession | undefined {
		if (!this.sessionId || !Number.isFinite(this.firstMs)) return undefined;
		const tools: ToolSummary[] = [...this.toolCounts]
			.map(([tool, calls]) => ({ tool, calls, failures: undefined }))
			.sort((a, b) => (a.tool < b.tool ? -1 : a.tool > b.tool ? 1 : 0));
		return {
			agent: "codex",
			sessionId: this.sessionId,
			...(this.cwd ? { cwd: this.cwd } : {}),
			...(this.branch ? { branch: this.branch } : {}),
			...(this.model ? { model: this.model } : {}),
			startedAtMs: this.firstMs,
			lastEventAtMs: this.lastMs,
			...(this.total ? { tokens: this.total } : {}),
			...(this.contextTokens === undefined
				? {}
				: { contextTokens: this.contextTokens }),
			toolCalls: tools.reduce((sum, t) => sum + t.calls, 0),
			toolFailures: undefined,
			tools,
			models: [...this.modelTurns].map(([model, responses]) => ({
				model,
				responses,
			})),
			hourlyTokens: [...this.hours]
				.sort(([a], [b]) => a - b)
				.map(([hourStartMs, count]) => ({ hourStartMs, tokens: count })),
		};
	}
}
