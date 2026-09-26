import { type Static, Type } from "@sinclair/typebox";
import { EXECUTION_ACTOR_TYPES } from "../attributes.js";
import { CalendarDate, closed, Instant, schemaId, Token } from "./common.js";

const literals = <T extends readonly string[]>(values: T) =>
	Type.Union(values.map((v) => Type.Literal(v)));

export const STATUS_CATEGORIES = [
	"backlog",
	"unstarted",
	"started",
	"done",
	"canceled",
] as const;
export const ACTIVITY_EVENT_TYPES = [
	"issue.created",
	"issue.status_changed",
	"issue.assigned",
	"issue.updated",
	"pull_request.opened",
	"pull_request.merged",
	"pull_request.closed",
	"review.submitted",
	"commit.pushed",
	"ci.completed",
	"release.published",
	"run.started",
	"run.completed",
	"plan.updated",
	"decision.recorded",
	"config.changed",
	"evaluation.recorded",
] as const;
export const ENTITY_TYPES = [
	"issue",
	"pull_request",
	"ci_run",
	"run",
	"trace",
	"artifact",
] as const;

export const IngestIssueSchema = Type.Object(
	{
		external_id: Token(),
		// 存在しないkeyの要素は拒否する（Harnessforce側でのDB検証。schemaはToken形式だけを保証する）。
		project_key: Token(),
		identifier: Type.Optional(Token(64)),
		title: Type.String({ minLength: 1, maxLength: 1000 }),
		description: Type.Optional(Type.String({ maxLength: 100_000 })),
		status_category: literals(STATUS_CATEGORIES),
		raw_status: Type.Optional(Type.String({ maxLength: 200 })),
		is_blocked: Type.Optional(Type.Boolean()),
		assignee: Type.Optional(Token()),
		priority: Type.Optional(Type.String({ maxLength: 100 })),
		due_on: Type.Optional(CalendarDate),
		parent_external_id: Type.Optional(Token()),
		url: Type.Optional(Type.String({ format: "uri", maxLength: 2048 })),
		source_updated_at: Instant,
	},
	{ $id: schemaId("ingest-issue"), ...closed },
);
export type IngestIssue = Static<typeof IngestIssueSchema>;

export const IngestEventSchema = Type.Object(
	{
		event_id: Token(),
		event_type: literals(ACTIVITY_EVENT_TYPES),
		occurred_at: Instant,
		actor_type: literals(EXECUTION_ACTOR_TYPES),
		actor_id: Type.Optional(Token()),
		// idは内部IDではなく送信元でのID（sender-side）。解決はingest APIで届いたExternalRefの中だけで行う。
		entity: Type.Object({ type: literals(ENTITY_TYPES), id: Token() }, closed),
		payload: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
		correlation_id: Type.Optional(Token()),
		causation_id: Type.Optional(Token()),
	},
	{ $id: schemaId("ingest-event"), ...closed },
);
export type IngestEvent = Static<typeof IngestEventSchema>;
