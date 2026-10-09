import { isObject } from "@harnessforce/agent-core/object";

// terminal-view.md「本人の表示」「行」: 最後のeventがこの時間以内のsessionを`active`とする。
// agentの状態の判定ではなく、最後のeventからの経過時間による表示上の区切りである。
export const ACTIVE_WINDOW_MS = 60_000;
const HOUR_MS = 60 * 60 * 1000;
// semconvのToken（空白を含まない文字列）と同じ制約。満たさない値は数えない。
const MAX_TOOL_NAME = 128;
const MAX_MODEL = 128;
// API errorなどでClaude Codeが自分で作る応答。modelの呼び出しではない。
const SYNTHETIC_MODEL = "<synthetic>";
// detached HEADではgitBranchが"HEAD"になり、branchではない。
const DETACHED = "HEAD";
// offsetの無い時刻は瞬間として解釈できないため使わない。
const INSTANT =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

type Row = Record<string, unknown>;

export type TokenCounts = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
};

export type ToolSummary = { tool: string; calls: number; failures: number };

// 記録から計算した値だけを持つ。prompt、response、toolの入力と出力、path、commandは持たない（terminal-view.md「守ること」）。
export type TopSession = {
	sessionId: string;
	cwd?: string;
	branch?: string;
	// 直近のassistantの発話のmodel。
	model?: string;
	startedAtMs: number;
	lastEventAtMs: number;
	// usageを持つ応答が1つも無ければundefined（0と区別する）。
	tokens?: TokenCounts;
	// 直近の応答のusageの入力、cache read、cache writeの和。割合は示さない。
	contextTokens?: number;
	toolCalls: number;
	toolFailures: number;
	tools: ToolSummary[];
	// 応答の数をmodelごとに数えた値。
	models: { model: string; responses: number }[];
	hourlyTokens: { hourStartMs: number; tokens: number }[];
};

export type SessionState = "active" | "idle";

export function sessionState(
	lastEventAtMs: number,
	nowMs: number,
): SessionState {
	return nowMs - lastEventAtMs <= ACTIVE_WINDOW_MS ? "active" : "idle";
}

const isToken = (value: unknown, maxLength: number): value is string =>
	typeof value === "string" &&
	value.length >= 1 &&
	value.length <= maxLength &&
	/^\S+$/.test(value);

const tokens = (value: unknown) =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: undefined;

function toInstantMs(value: unknown): number | undefined {
	if (typeof value !== "string" || !INSTANT.test(value)) return undefined;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? undefined : ms;
}

export class SessionAccumulator {
	private sessionId: string | undefined;
	private cwd: string | undefined;
	private branch: string | undefined;
	private model: string | undefined;
	private firstMs = Number.POSITIVE_INFINITY;
	private lastMs = Number.NEGATIVE_INFINITY;
	private total: TokenCounts | undefined;
	private contextTokens: number | undefined;
	// 同じmessage.idの行（content blockごとに分かれる）は同じusageを持つため、1つの応答として1回だけ数える。
	private readonly responseIds = new Set<string>();
	private readonly toolNames = new Map<string, string>();
	private readonly failedToolUses = new Set<string>();
	private readonly modelResponses = new Map<string, number>();
	private readonly hours = new Map<number, number>();

	add(row: Row): void {
		if (this.sessionId === undefined && isToken(row.sessionId, 256))
			this.sessionId = row.sessionId;
		const ms = toInstantMs(row.timestamp);
		if (ms !== undefined) {
			this.firstMs = Math.min(this.firstMs, ms);
			this.lastMs = Math.max(this.lastMs, ms);
		}
		if (row.type !== "user" && row.type !== "assistant") return;
		// branchとcwdはsessionの開始時点の値とする（session importと同じ）。
		if (this.cwd === undefined && typeof row.cwd === "string")
			this.cwd = row.cwd;
		if (
			this.branch === undefined &&
			isToken(row.gitBranch, 256) &&
			row.gitBranch !== DETACHED
		)
			this.branch = row.gitBranch;
		const message = isObject(row.message) ? row.message : {};
		if (row.type === "assistant") this.addResponse(message, ms);
		else this.addResults(message);
	}

	private addResults(message: Row): void {
		if (!Array.isArray(message.content)) return;
		for (const block of message.content)
			if (
				isObject(block) &&
				block.type === "tool_result" &&
				block.is_error === true &&
				typeof block.tool_use_id === "string"
			)
				this.failedToolUses.add(block.tool_use_id);
	}

	private addResponse(message: Row, ms: number | undefined): void {
		if (Array.isArray(message.content))
			for (const block of message.content)
				if (
					isObject(block) &&
					block.type === "tool_use" &&
					typeof block.id === "string" &&
					isToken(block.name, MAX_TOOL_NAME)
				)
					this.toolNames.set(block.id, block.name);
		if (
			typeof message.id !== "string" ||
			this.responseIds.has(message.id) ||
			!isToken(message.model, MAX_MODEL) ||
			message.model === SYNTHETIC_MODEL
		)
			return;
		this.responseIds.add(message.id);
		this.model = message.model;
		this.modelResponses.set(
			message.model,
			(this.modelResponses.get(message.model) ?? 0) + 1,
		);
		if (!isObject(message.usage)) return;
		const { usage } = message;
		const input = tokens(usage.input_tokens);
		const output = tokens(usage.output_tokens);
		const cacheRead = tokens(usage.cache_read_input_tokens) ?? 0;
		const cacheWrite = tokens(usage.cache_creation_input_tokens) ?? 0;
		if (input === undefined && output === undefined) return;
		const counts = {
			input: input ?? 0,
			output: output ?? 0,
			cacheRead,
			cacheWrite,
		};
		this.total = {
			input: (this.total?.input ?? 0) + counts.input,
			output: (this.total?.output ?? 0) + counts.output,
			cacheRead: (this.total?.cacheRead ?? 0) + counts.cacheRead,
			cacheWrite: (this.total?.cacheWrite ?? 0) + counts.cacheWrite,
		};
		this.contextTokens = counts.input + counts.cacheRead + counts.cacheWrite;
		if (ms !== undefined) {
			const hour = Math.floor(ms / HOUR_MS) * HOUR_MS;
			this.hours.set(
				hour,
				(this.hours.get(hour) ?? 0) + counts.input + counts.output,
			);
		}
	}

	private summarizeTools(): ToolSummary[] {
		const summaries = new Map<string, ToolSummary>();
		for (const [id, tool] of this.toolNames) {
			const summary = summaries.get(tool) ?? { tool, calls: 0, failures: 0 };
			summaries.set(tool, {
				tool,
				calls: summary.calls + 1,
				failures: summary.failures + (this.failedToolUses.has(id) ? 1 : 0),
			});
		}
		return [...summaries.values()].sort((a, b) =>
			a.tool < b.tool ? -1 : a.tool > b.tool ? 1 : 0,
		);
	}

	result(): TopSession | undefined {
		if (!this.sessionId || !Number.isFinite(this.firstMs)) return undefined;
		const tools = this.summarizeTools();
		return {
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
			toolFailures: tools.reduce((sum, t) => sum + t.failures, 0),
			tools,
			models: [...this.modelResponses].map(([model, responses]) => ({
				model,
				responses,
			})),
			hourlyTokens: [...this.hours]
				.sort(([a], [b]) => a - b)
				.map(([hourStartMs, count]) => ({ hourStartMs, tokens: count })),
		};
	}
}
