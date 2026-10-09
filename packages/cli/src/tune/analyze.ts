import {
	type AnalysisReport,
	INTERVENTION_KINDS,
	LOOP_KINDS,
	PROPOSAL_KINDS,
} from "@harnessforce/semconv";
import {
	PARSER_VERSION,
	type TranscriptEvent,
	type TranscriptSession,
} from "../import/transcript.js";
import { isMcpTool, type McpConfig, UNLISTED } from "./mcp-config.js";
import {
	CI_FAILURE_OUTPUT,
	CI_RELAY_PATTERNS,
	COMMANDS,
	CONTINUE_PHRASES,
	EDIT_TOOLS,
	ISSUE_TOOL,
	REVIEW_RELAY_PATTERNS,
} from "./vocabulary.js";

// 分析の規則（このfile、vocabulary.ts、mcp-config.ts、usage.tsの対応）のversion。規則を変えたら上げる。
export const ANALYZER_VERSION = "1.1.0";

type InterventionKind = (typeof INTERVENTION_KINDS)[number];
type LoopKind = (typeof LOOP_KINDS)[number];
type ProposalCounts = AnalysisReport["proposals"];

// improvement-loop.md「受入時に実測する事項」: 記録は権限の確認への許可を残さず（拒否だけが残る）、
// agentの質問への回答を他のpromptと区別できない。この2つは判定しない。
const NOT_MEASURED_INTERVENTIONS: ReadonlySet<InterventionKind> = new Set([
	"approval",
	"answer",
]);

export const emptyProposalCounts = (): ProposalCounts =>
	Object.fromEntries(
		PROPOSAL_KINDS.map((kind) => [kind, { shown: 0, applied_detected: 0 }]),
	) as ProposalCounts;

// semantic-conventions.md「Analysis report」: 件数が偶数なら中央の2つの平均。
export function median(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

const seconds = (fromMs: number, toMs: number) =>
	Math.max(0, toMs - fromMs) / 1000;

const normalizePhrase = (text: string) =>
	text
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[\s.!?。．！？、,]+$/u, "")
		.replace(/\s+/g, " ")
		.trim();

function classifyPrompt(text: string): InterventionKind {
	if (CI_RELAY_PATTERNS.some((pattern) => pattern.test(text)))
		return "ci_relay";
	if (REVIEW_RELAY_PATTERNS.some((pattern) => pattern.test(text)))
		return "review_relay";
	if (CONTINUE_PHRASES.has(normalizePhrase(text))) return "continue";
	return "other";
}

type Intervention = { kind: InterventionKind; ms: number; waitSeconds: number };

// 直前にagentの応答がある人のpromptだけを介入として数える。sessionの最初のpromptは応答を持たない。
function findInterventions(events: readonly TranscriptEvent[]): Intervention[] {
	const interventions: Intervention[] = [];
	let lastResponseMs: number | undefined;
	for (const event of events) {
		if (event.type === "response") lastResponseMs = event.ms;
		if (event.type !== "prompt") continue;
		if (lastResponseMs !== undefined)
			interventions.push({
				kind: classifyPrompt(event.text),
				ms: event.ms,
				waitSeconds: seconds(lastResponseMs, event.ms),
			});
		lastResponseMs = undefined;
	}
	return interventions;
}

function summarizeInterventions(
	interventions: readonly Intervention[],
): AnalysisReport["interventions"] {
	return Object.fromEntries(
		INTERVENTION_KINDS.map((kind) => {
			if (NOT_MEASURED_INTERVENTIONS.has(kind))
				return [
					kind,
					{
						measurement: "not_measured",
						count: null,
						wait_seconds_median: null,
					},
				];
			const waits = interventions
				.filter((i) => i.kind === kind)
				.map((i) => i.waitSeconds);
			return [
				kind,
				{
					measurement: "measured",
					count: waits.length,
					wait_seconds_median: median(waits),
				},
			];
		}),
	) as AnalysisReport["interventions"];
}

// 1つのloopの判定に使う、eventの性質。
type Step = {
	event: TranscriptEvent;
	command: string | undefined;
	// tool_resultでは、対応するtool_useのcommandとtool名。
	resultOf: { name: string; command: string | undefined } | undefined;
	promptKind: InterventionKind | undefined;
};

const commandMatches = (
	pattern: RegExp,
	command: string | undefined,
): boolean => command !== undefined && pattern.test(command);

const isFailedResult = (step: Step, pattern: RegExp) =>
	step.event.type === "tool_result" &&
	step.event.isError &&
	!step.event.isDenied &&
	commandMatches(pattern, step.resultOf?.command);

const isToolUse = (step: Step) => step.event.type === "tool_use";
const isEdit = (step: Step) =>
	step.event.type === "tool_use" && EDIT_TOOLS.has(step.event.name);
const usesCommand = (step: Step, pattern: RegExp) =>
	isToolUse(step) && commandMatches(pattern, step.command);

// improvement-loop.md「ループにできる繰り返し」: 始まり、途中の手順、終わりが順に現れたら一巡とする。
type LoopRule = {
	starts: (step: Step) => boolean;
	advances: (step: Step) => boolean;
	closes: (step: Step) => boolean;
};

const LOOP_RULES: Record<LoopKind, LoopRule> = {
	issue_to_pr: {
		starts: (s) =>
			usesCommand(s, COMMANDS.issueFetch) ||
			(s.event.type === "tool_use" && ISSUE_TOOL.test(s.event.name)),
		advances: isEdit,
		closes: (s) => usesCommand(s, COMMANDS.prCreate),
	},
	ci_fix: {
		starts: (s) =>
			s.promptKind === "ci_relay" ||
			(s.event.type === "tool_result" &&
				!s.event.isDenied &&
				commandMatches(COMMANDS.ciCheck, s.resultOf?.command) &&
				(s.event.isError || CI_FAILURE_OUTPUT.test(s.event.output))),
		advances: isEdit,
		closes: (s) => usesCommand(s, COMMANDS.push),
	},
	review_response: {
		starts: (s) =>
			s.promptKind === "review_relay" || usesCommand(s, COMMANDS.reviewFetch),
		advances: isEdit,
		closes: (s) => usesCommand(s, COMMANDS.push),
	},
	test_fix: {
		starts: (s) => isFailedResult(s, COMMANDS.test),
		advances: isEdit,
		closes: (s) => usesCommand(s, COMMANDS.test),
	},
	lint_fix: {
		starts: (s) => isFailedResult(s, COMMANDS.lint),
		advances: isEdit,
		closes: (s) => usesCommand(s, COMMANDS.lint),
	},
	dependency_update: {
		starts: (s) => usesCommand(s, COMMANDS.dependencyUpdate),
		advances: (s) => usesCommand(s, COMMANDS.test),
		closes: (s) => usesCommand(s, COMMANDS.prCreate),
	},
};

type Cycle = { startMs: number; interventions: number; closeMs: number };

function findCycles(
	rule: LoopRule,
	steps: readonly Step[],
	interventions: readonly Intervention[],
): Cycle[] {
	const cycles: Cycle[] = [];
	let open: { startMs: number; hasAdvanced: boolean } | undefined;
	for (const step of steps) {
		if (open?.hasAdvanced && rule.closes(step)) {
			const { startMs } = open;
			cycles.push({
				startMs,
				closeMs: step.event.ms,
				interventions: interventions.filter(
					(i) => i.ms >= startMs && i.ms <= step.event.ms,
				).length,
			});
			open = undefined;
		}
		if (rule.starts(step))
			open = { startMs: step.event.ms, hasAdvanced: false };
		else if (open && rule.advances(step)) open.hasAdvanced = true;
	}
	return cycles;
}

function toSteps(events: readonly TranscriptEvent[]): Step[] {
	const toolUses = new Map<
		string,
		{ name: string; command: string | undefined }
	>();
	return events.map((event) => {
		if (event.type === "tool_use")
			toolUses.set(event.id, { name: event.name, command: event.command });
		return {
			event,
			command: event.type === "tool_use" ? event.command : undefined,
			resultOf:
				event.type === "tool_result"
					? toolUses.get(event.toolUseId)
					: undefined,
			// 介入に数えないsessionの最初のpromptも、CIの失敗やreviewの指摘からloopを始める。
			promptKind:
				event.type === "prompt" ? classifyPrompt(event.text) : undefined,
		};
	});
}

function summarizeLoops(
	events: readonly TranscriptEvent[],
	interventions: readonly Intervention[],
): AnalysisReport["loops"] {
	const steps = toSteps(events);
	return Object.fromEntries(
		LOOP_KINDS.map((kind) => {
			const cycles = findCycles(LOOP_RULES[kind], steps, interventions);
			return [
				kind,
				{
					measurement: "measured",
					occurrences: cycles.length,
					interventions: cycles.reduce((sum, c) => sum + c.interventions, 0),
					duration_seconds_median: median(
						cycles.map((c) => seconds(c.startMs, c.closeMs)),
					),
				},
			];
		}),
	) as AnalysisReport["loops"];
}

function summarizeMcp(
	events: readonly TranscriptEvent[],
	mcp: McpConfig,
): AnalysisReport["mcp_servers"] {
	const serverOf = new Map<string, string>();
	const counts = new Map<string, { calls: number; failures: number }>(
		mcp.servers.map((server) => [server, { calls: 0, failures: 0 }]),
	);
	const bump = (server: string, field: "calls" | "failures") => {
		const count = counts.get(server) ?? { calls: 0, failures: 0 };
		counts.set(server, { ...count, [field]: count[field] + 1 });
	};
	for (const event of events) {
		if (event.type === "tool_use") {
			if (!isMcpTool(event.name)) continue;
			const server = mcp.serverOf(event.name);
			serverOf.set(event.id, server);
			bump(server, "calls");
		}
		// 権限の確認で拒否された呼び出しは実行されておらず、serverの失敗ではない。
		if (event.type === "tool_result" && event.isError && !event.isDenied) {
			const server = serverOf.get(event.toolUseId);
			if (server !== undefined) bump(server, "failures");
		}
	}
	return [...counts]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([server, count]) => ({
			server,
			configured: server !== UNLISTED,
			measurement: "measured" as const,
			calls: count.calls,
			failures_measurement: "measured" as const,
			failures: count.failures,
		}));
}

export type AnalyzeInput = {
	session: TranscriptSession;
	events: readonly TranscriptEvent[];
	skippedLines: number;
	mcp: McpConfig;
	proposals: ProposalCounts;
};

// improvement-loop.md「送る値（固定語彙）」: 1つのsessionのanalysis report。本文を含めない。
export function analyzeSession(input: AnalyzeInput): AnalysisReport {
	const interventions = findInterventions(input.events);
	return {
		agent: "claude_code",
		session_id: input.session.sessionId,
		...(input.session.firstPromptId
			? { first_prompt_id: input.session.firstPromptId }
			: {}),
		started_at: input.session.startedAt,
		analyzer_version: ANALYZER_VERSION,
		parser_version: PARSER_VERSION,
		interventions: summarizeInterventions(interventions),
		loops: summarizeLoops(input.events, interventions),
		mcp_servers: summarizeMcp(input.events, input.mcp),
		proposals: input.proposals,
		records_skipped: input.skippedLines,
	};
}
