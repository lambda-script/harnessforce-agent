import { type Static, Type } from "@sinclair/typebox";
import {
	Agent,
	Count,
	closed,
	Instant,
	SemVer,
	schemaId,
	Token,
} from "./common.js";

const Calls = Type.Integer({ minimum: 1 });
// semantic-conventions.md「Session usage summary」: 1つの一覧のitemsの上限。残りはotherへ加える。
const limited = { maxItems: 200 };

// skills、subagents、mcp_serversの一覧。
const CallList = Type.Object(
	{
		items: Type.Array(
			Type.Object({ name: Token(), calls: Calls, failures: Count }, closed),
			limited,
		),
		other: Type.Object({ calls: Count, failures: Count }, closed),
	},
	closed,
);

// commandの展開には失敗の記録が無いため、0と数えた失敗を持たない。
const CommandList = Type.Object(
	{
		items: Type.Array(
			Type.Object({ name: Token(), calls: Calls }, closed),
			limited,
		),
		other: Type.Object({ calls: Count }, closed),
	},
	closed,
);

// itemsのnameの重複、failuresがcallsを超える値、started_atがlast_event_atより後の値もschema違反だが、
// JSON Schemaでは表せないため、受け取る側が別に確かめる。
export const SessionUsageSummarySchema = Type.Object(
	{
		agent: Agent,
		session_id: Token(),
		first_prompt_id: Type.Optional(Token()),
		started_at: Instant,
		last_event_at: Instant,
		collector_version: SemVer,
		skills: CallList,
		commands: CommandList,
		subagents: CallList,
		mcp_servers: CallList,
		permission_requests: Count,
		compactions: Type.Object({ auto: Count, manual: Count }, closed),
	},
	{ $id: schemaId("session-usage-summary"), ...closed },
);
export type SessionUsageSummary = Static<typeof SessionUsageSummarySchema>;
