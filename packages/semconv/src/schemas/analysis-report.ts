import { type Static, type TSchema, Type } from "@sinclair/typebox";
import {
	Agent,
	Count,
	closed,
	Instant,
	SemVer,
	schemaId,
	Token,
} from "./common.js";

export const INTERVENTION_KINDS = [
	"approval",
	"continue",
	"ci_relay",
	"review_relay",
	"answer",
	"other",
] as const;
export const LOOP_KINDS = [
	"issue_to_pr",
	"ci_fix",
	"review_response",
	"test_fix",
	"lint_fix",
	"dependency_update",
] as const;
export const PROPOSAL_KINDS = [
	"permissions",
	"hook",
	"skill",
	"rule",
	"agent",
	"command",
	"loop_prompt",
	"mcp_config",
	"claude_md",
] as const;
export const MEASUREMENTS = ["measured", "not_measured"] as const;

const Seconds = Type.Number({ minimum: 0 });

// semantic-conventions.md「Analysis report」: measuredでは、中央値の元になる件数が0なら中央値はnull、1以上なら数値。
// not_measuredでは全項目をnullにし、0と区別する。
const measuredOrNot = (
	counted: string,
	median: string,
	others: Record<string, TSchema> = {},
) => {
	const measured = (count: TSchema, value: TSchema) =>
		Type.Object(
			{
				measurement: Type.Literal("measured"),
				[counted]: count,
				...others,
				[median]: value,
			},
			closed,
		);
	return Type.Union([
		measured(Type.Literal(0), Type.Null()),
		measured(Type.Integer({ minimum: 1 }), Seconds),
		Type.Object(
			{
				measurement: Type.Literal("not_measured"),
				...Object.fromEntries(
					[counted, ...Object.keys(others), median].map((k) => [
						k,
						Type.Null(),
					]),
				),
			},
			closed,
		),
	]);
};

const byKind = <K extends readonly string[]>(kinds: K, value: TSchema) =>
	Type.Object(
		Object.fromEntries(kinds.map((k) => [k, value])) as Record<
			K[number],
			TSchema
		>,
		closed,
	);

const Intervention = measuredOrNot("count", "wait_seconds_median");
const Loop = measuredOrNot("occurrences", "duration_seconds_median", {
	interventions: Count,
});

const mcpVariant = (callsMeasured: boolean, failuresMeasured: boolean) =>
	Type.Object(
		{
			server: Token(),
			configured: Type.Boolean(),
			measurement: Type.Literal(callsMeasured ? "measured" : "not_measured"),
			calls: callsMeasured ? Count : Type.Null(),
			failures_measurement: Type.Literal(
				failuresMeasured ? "measured" : "not_measured",
			),
			failures: failuresMeasured ? Count : Type.Null(),
		},
		closed,
	);

const McpServer = Type.Union([
	mcpVariant(true, true),
	mcpVariant(true, false),
	mcpVariant(false, true),
	mcpVariant(false, false),
]);
const ProposalCount = Type.Object(
	{ shown: Count, applied_detected: Count },
	closed,
);

export const AnalysisReportSchema = Type.Object(
	{
		agent: Agent,
		session_id: Token(),
		// 記録から取れなければ省略（session registrationのfirst_prompt_idと同じ意味）。
		first_prompt_id: Type.Optional(Token()),
		started_at: Instant,
		analyzer_version: SemVer,
		parser_version: SemVer,
		interventions: byKind(INTERVENTION_KINDS, Intervention),
		loops: byKind(LOOP_KINDS, Loop),
		mcp_servers: Type.Array(McpServer),
		proposals: byKind(PROPOSAL_KINDS, ProposalCount),
		records_skipped: Count,
	},
	{ $id: schemaId("analysis-report"), ...closed },
);
export type AnalysisReport = Static<typeof AnalysisReportSchema>;
