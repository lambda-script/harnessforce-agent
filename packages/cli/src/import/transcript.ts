import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

// Claude Codeのtranscript（~/.claude/projects/<project>/<session>.jsonl）の形式は公式に文書化されていない
// （claude-code.md）。解釈を変えたらこのversionを上げ、送るsessionにparser_versionとして付ける。
export const PARSER_VERSION = "1.0.0";

export type ToolCallSummary = { tool: string; calls: number; failures: number };

// 取り出すのはsemantic-conventions.md「Session import」の項目の元になる値だけで、本文を持たない。
export type TranscriptSession = {
	sessionId: string;
	firstPromptId?: string;
	cwd?: string;
	branch?: string;
	startedAt: string;
	endedAt: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
	toolCalls: ToolCallSummary[];
};

export type TranscriptResult =
	| { kind: "session"; session: TranscriptSession; skippedLines: number }
	// 読めたが、送れるsession（session ID、時刻、modelの応答）が無い。応答の前に終わったsessionなど。
	| { kind: "empty"; skippedLines: number }
	| { kind: "unreadable"; skippedLines: number };

// semconvのToken（空白を含まない文字列）と同じ制約。満たさない値は数えない。
const isToken = (value: unknown, maxLength = 256): value is string =>
	typeof value === "string" &&
	value.length >= 1 &&
	value.length <= maxLength &&
	/^\S+$/.test(value);
const MAX_TOOL_NAME = 128;
const MAX_MODEL = 128;
// API errorなどでClaude Codeが自分で作る応答。modelの呼び出しではない。
const SYNTHETIC_MODEL = "<synthetic>";
// offsetの無い時刻は瞬間として解釈できないため使わない。
const INSTANT =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
// detached HEADではgitBranchが"HEAD"になり、branchではない。
const DETACHED = "HEAD";

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const count = (value: unknown) =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: 0;

function toInstantMs(value: unknown): number | undefined {
	if (typeof value !== "string" || !INSTANT.test(value)) return undefined;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? undefined : ms;
}

class Accumulator {
	sessionId: string | undefined;
	firstPromptId: string | undefined;
	cwd: string | undefined;
	branch: string | undefined;
	firstMs = Number.POSITIVE_INFINITY;
	lastMs = Number.NEGATIVE_INFINITY;
	inputTokens = 0;
	outputTokens = 0;
	// 応答ごとのmodel。同じmessage.idの行（content blockごとに分かれる）は1つの応答とする。
	readonly responses = new Map<string, string>();
	readonly toolNames = new Map<string, string>();
	readonly failedToolUses = new Set<string>();

	add(row: Row): void {
		if (this.sessionId === undefined && isToken(row.sessionId))
			this.sessionId = row.sessionId;
		const ms = toInstantMs(row.timestamp);
		if (ms !== undefined) {
			this.firstMs = Math.min(this.firstMs, ms);
			this.lastMs = Math.max(this.lastMs, ms);
		}
		if (row.type !== "user" && row.type !== "assistant") return;
		// branchとcwdはsessionの開始時点の値とする（correlation.md「Run→Pull Request」）。
		if (this.cwd === undefined && typeof row.cwd === "string")
			this.cwd = row.cwd;
		if (this.branch === undefined && isToken(row.gitBranch))
			this.branch = row.gitBranch;
		const message = isRow(row.message) ? row.message : {};
		if (row.type === "user") this.addUser(row, message);
		else this.addResponse(message);
	}

	private addUser(row: Row, message: Row): void {
		if (this.firstPromptId === undefined && isToken(row.promptId))
			this.firstPromptId = row.promptId;
		if (!Array.isArray(message.content)) return;
		for (const block of message.content)
			if (
				isRow(block) &&
				block.type === "tool_result" &&
				block.is_error === true &&
				typeof block.tool_use_id === "string"
			)
				this.failedToolUses.add(block.tool_use_id);
	}

	private addResponse(message: Row): void {
		if (Array.isArray(message.content))
			for (const block of message.content)
				if (
					isRow(block) &&
					block.type === "tool_use" &&
					typeof block.id === "string" &&
					isToken(block.name, MAX_TOOL_NAME)
				)
					this.toolNames.set(block.id, block.name);
		if (
			typeof message.id !== "string" ||
			this.responses.has(message.id) ||
			!isToken(message.model, MAX_MODEL) ||
			message.model === SYNTHETIC_MODEL
		)
			return;
		this.responses.set(message.id, message.model);
		const usage = isRow(message.usage) ? message.usage : {};
		this.inputTokens += count(usage.input_tokens);
		this.outputTokens += count(usage.output_tokens);
	}

	// semantic-conventions.md「Session import」: 応答の数が最も多いmodel。同数なら最後に使ったmodel。
	private mostUsedModel(): string | undefined {
		const counts = new Map<string, number>();
		let best: string | undefined;
		for (const model of this.responses.values()) {
			const next = (counts.get(model) ?? 0) + 1;
			counts.set(model, next);
			if (best === undefined || next >= (counts.get(best) ?? 0)) best = model;
		}
		return best;
	}

	private summarizeTools(): ToolCallSummary[] {
		const summaries = new Map<string, ToolCallSummary>();
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

	result(): TranscriptSession | undefined {
		const model = this.mostUsedModel();
		if (!this.sessionId || !model || !Number.isFinite(this.firstMs))
			return undefined;
		return {
			sessionId: this.sessionId,
			...(this.firstPromptId ? { firstPromptId: this.firstPromptId } : {}),
			...(this.cwd ? { cwd: this.cwd } : {}),
			...(this.branch && this.branch !== DETACHED
				? { branch: this.branch }
				: {}),
			startedAt: new Date(this.firstMs).toISOString(),
			endedAt: new Date(this.lastMs).toISOString(),
			model,
			inputTokens: this.inputTokens,
			outputTokens: this.outputTokens,
			toolCalls: this.summarizeTools(),
		};
	}
}

// 読めない行（JSONのobjectでない行）は読み飛ばして数える。fileを開けない、または途中で読めなくなった場合は、file全体を読めないものとする。
export async function parseTranscript(path: string): Promise<TranscriptResult> {
	const accumulator = new Accumulator();
	let skippedLines = 0;
	try {
		const lines = createInterface({
			input: createReadStream(path, { encoding: "utf8" }),
			crlfDelay: Number.POSITIVE_INFINITY,
		});
		for await (const text of lines) {
			let row: unknown;
			try {
				row = JSON.parse(text);
			} catch {
				skippedLines += 1;
				continue;
			}
			if (isRow(row)) accumulator.add(row);
			else skippedLines += 1;
		}
	} catch {
		return { kind: "unreadable", skippedLines };
	}
	const session = accumulator.result();
	return session
		? { kind: "session", session, skippedLines }
		: { kind: "empty", skippedLines };
}
