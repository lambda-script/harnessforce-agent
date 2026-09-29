import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { isObject } from "@harnessforce/agent-core/object";

// Claude Codeのtranscript（~/.claude/projects/<project>/<session>.jsonl）の形式は公式に文書化されていない
// （claude-code.md）。解釈を変えたらこのversionを上げ、送るsessionにparser_versionとして付ける。
export const PARSER_VERSION = "1.1.0";

type ToolCallSummary = { tool: string; calls: number; failures: number };

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

// hf tuneの分析に使うevent（improvement-loop.md「読むもの」）。本文を含むため、端末の外へ出さず、表示もしない。
export type TranscriptEvent =
	| { type: "prompt"; ms: number; text: string }
	| { type: "response"; ms: number }
	| { type: "tool_use"; ms: number; id: string; name: string; command?: string }
	| {
			type: "tool_result";
			ms: number;
			toolUseId: string;
			isError: boolean;
			// 権限の確認で拒否された呼び出し。実行されていないため、toolの失敗ではない。
			isDenied: boolean;
			output: string;
	  };

export type TranscriptEvents =
	| {
			kind: "session";
			session: TranscriptSession;
			events: TranscriptEvent[];
			lines: number;
			skippedLines: number;
	  }
	| { kind: "empty" | "unreadable"; lines: number; skippedLines: number };

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
// tool_resultの本文は、CIの失敗の判定に使う先頭だけを持つ。
const MAX_OUTPUT_LENGTH = 8192;
// Claude Codeがpromptの形で記録する、人が入力していない行の先頭。
const NON_HUMAN_PREFIXES = [
	"<local-command-stdout>",
	"<local-command-stderr>",
	"<local-command-caveat>",
	"<task-notification>",
	"<system-reminder>",
	"<bash-stdout>",
	"<bash-stderr>",
	"[Request interrupted by user",
];
// promptSourceが示す、人が入力していないprompt。
const NON_HUMAN_SOURCES = new Set(["system", "sdk"]);
// offsetの無い時刻は瞬間として解釈できないため使わない。
const INSTANT =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
// detached HEADではgitBranchが"HEAD"になり、branchではない。
const DETACHED = "HEAD";

type Row = Record<string, unknown>;
const count = (value: unknown) =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: 0;

function toInstantMs(value: unknown): number | undefined {
	if (typeof value !== "string" || !INSTANT.test(value)) return undefined;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? undefined : ms;
}

const textOf = (content: unknown): string | undefined => {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return undefined;
	const texts: string[] = [];
	for (const block of content) {
		if (
			!isObject(block) ||
			block.type !== "text" ||
			typeof block.text !== "string"
		)
			return undefined;
		texts.push(block.text);
	}
	return texts.join("\n");
};

// 人が入力したprompt。meta、subagent、要約、通知、commandの出力、tool_resultは含めない。
function humanPromptText(row: Row, message: Row): string | undefined {
	if (row.isMeta === true || row.isCompactSummary === true) return undefined;
	if (isObject(row.origin) && row.origin.kind !== "human") return undefined;
	if (
		typeof row.promptSource === "string" &&
		NON_HUMAN_SOURCES.has(row.promptSource)
	)
		return undefined;
	const text = textOf(message.content)?.trim();
	if (!text || NON_HUMAN_PREFIXES.some((prefix) => text.startsWith(prefix)))
		return undefined;
	return text;
}

const outputOf = (content: unknown): string =>
	(typeof content === "string"
		? content
		: Array.isArray(content)
			? content
					.map((block) =>
						isObject(block) && typeof block.text === "string" ? block.text : "",
					)
					.join("\n")
			: ""
	).slice(0, MAX_OUTPUT_LENGTH);

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

	// 分析に使うeventを集める場合だけ配列を持つ。hf importは集めない。
	constructor(readonly events?: TranscriptEvent[]) {}

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
		const message = isObject(row.message) ? row.message : {};
		if (row.type === "user") this.addUser(row, message);
		else this.addResponse(message);
		if (ms !== undefined && row.isSidechain !== true)
			this.addEvents(row, message, ms);
	}

	private addEvents(row: Row, message: Row, ms: number): void {
		const events = this.events;
		if (!events) return;
		if (row.type === "assistant") {
			events.push({ type: "response", ms });
			if (!Array.isArray(message.content)) return;
			for (const block of message.content) {
				if (
					!isObject(block) ||
					block.type !== "tool_use" ||
					typeof block.id !== "string" ||
					typeof block.name !== "string"
				)
					continue;
				const input = isObject(block.input) ? block.input : {};
				events.push({
					type: "tool_use",
					ms,
					id: block.id,
					name: block.name,
					...(typeof input.command === "string"
						? { command: input.command }
						: {}),
				});
			}
			return;
		}
		if (Array.isArray(message.content)) {
			const results = message.content.filter(
				(block) =>
					isObject(block) &&
					block.type === "tool_result" &&
					typeof block.tool_use_id === "string",
			) as Row[];
			for (const block of results)
				events.push({
					type: "tool_result",
					ms,
					toolUseId: block.tool_use_id as string,
					isError: block.is_error === true,
					isDenied: typeof row.toolDenialKind === "string",
					output: outputOf(block.content),
				});
			if (results.length > 0) return;
		}
		const text = humanPromptText(row, message);
		if (text !== undefined) events.push({ type: "prompt", ms, text });
	}

	private addUser(row: Row, message: Row): void {
		if (this.firstPromptId === undefined && isToken(row.promptId))
			this.firstPromptId = row.promptId;
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

	private addResponse(message: Row): void {
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
			this.responses.has(message.id) ||
			!isToken(message.model, MAX_MODEL) ||
			message.model === SYNTHETIC_MODEL
		)
			return;
		this.responses.set(message.id, message.model);
		const usage = isObject(message.usage) ? message.usage : {};
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

type Read = {
	session: TranscriptSession | undefined;
	isReadable: boolean;
	lines: number;
	skippedLines: number;
};

// 読めない行（JSONのobjectでない行）は読み飛ばして数える。fileを開けない、または途中で読めなくなった場合は、file全体を読めないものとする。
async function readTranscript(
	path: string,
	accumulator: Accumulator,
): Promise<Read> {
	let lines = 0;
	let skippedLines = 0;
	try {
		const reader = createInterface({
			input: createReadStream(path, { encoding: "utf8" }),
			crlfDelay: Number.POSITIVE_INFINITY,
		});
		for await (const text of reader) {
			lines += 1;
			let row: unknown;
			try {
				row = JSON.parse(text);
			} catch {
				skippedLines += 1;
				continue;
			}
			if (isObject(row)) accumulator.add(row);
			else skippedLines += 1;
		}
	} catch {
		return { session: undefined, isReadable: false, lines, skippedLines };
	}
	return {
		session: accumulator.result(),
		isReadable: true,
		lines,
		skippedLines,
	};
}

export async function parseTranscript(path: string): Promise<TranscriptResult> {
	const { session, isReadable, skippedLines } = await readTranscript(
		path,
		new Accumulator(),
	);
	if (!isReadable) return { kind: "unreadable", skippedLines };
	return session
		? { kind: "session", session, skippedLines }
		: { kind: "empty", skippedLines };
}

// hf tuneの読み込み。hf importと同じ処理で読み、分析に使うeventの列を加える。
export async function parseTranscriptEvents(
	path: string,
): Promise<TranscriptEvents> {
	const events: TranscriptEvent[] = [];
	const { session, isReadable, lines, skippedLines } = await readTranscript(
		path,
		new Accumulator(events),
	);
	if (!isReadable) return { kind: "unreadable", lines, skippedLines };
	return session
		? { kind: "session", session, events, lines, skippedLines }
		: { kind: "empty", lines, skippedLines };
}
