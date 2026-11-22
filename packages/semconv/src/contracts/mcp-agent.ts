import { Type } from "@sinclair/typebox";
import { Agent, closed, Token } from "../schemas/common.js";

// mcp.md「agentとの契約」: pluginの資産（skill、command、session context）が名前で呼ぶMCPのtoolと、送る`q`の正本。
// 入力のschemaは閉じたobjectとし、本体のtoolの`inputSchema`の部分集合とする。結果のschemaはagentが読む項目だけを持つ。
// 結果は、本体の検査では未知の項目を許す開いたobjectとして、agentの検査では閉じたobjectとして当てる（`openResult`）。

const IssueIdentifier = Token(300);
const SessionId = Type.String({
	pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
});
const UpdatedAt = Type.String({ format: "date-time" });

const IssueSummary = Type.Object(
	{ identifier: Type.String(), title: Type.String() },
	closed,
);

export const MCP_AGENT_TOOLS = {
	get_issue: {
		input: Type.Object({ identifier: IssueIdentifier }, closed),
		inputExamples: [{ identifier: "acme/app#42" }],
		result: IssueSummary,
		errorCodes: ["not_found"],
	},
	start_session: {
		input: Type.Object(
			{
				issue_identifier: IssueIdentifier,
				agent: Agent,
				agent_session_id: Token(),
			},
			closed,
		),
		inputExamples: [
			{
				issue_identifier: "acme/app#42",
				agent: "claude_code",
				agent_session_id: "0b6f3c2e-5d1a-4c8e-9f7a-2e4d6b8a1c3f",
			},
		],
		result: Type.Object({ session_id: SessionId }, closed),
		errorCodes: ["forbidden", "conflict"],
	},
	complete_session: {
		input: Type.Object({ session_id: SessionId }, closed),
		inputExamples: [{ session_id: "018f2a4b-6c7d-7e8f-9a0b-1c2d3e4f5a6b" }],
		result: Type.Object({}, closed),
		errorCodes: ["forbidden", "conflict"],
	},
	list_issues: {
		input: Type.Object(
			{ q: Type.String(), sort: Type.Literal("updated") },
			closed,
		),
		inputExamples: [
			{ q: "-status:resolved,not_planned login", sort: "updated" },
		],
		result: Type.Object(
			{
				items: Type.Array(
					Type.Object(
						{
							identifier: Type.String(),
							title: Type.String(),
							updated_at: UpdatedAt,
						},
						closed,
					),
				),
			},
			closed,
		),
		errorCodes: [],
	},
} as const;

export type McpAgentToolName = keyof typeof MCP_AGENT_TOOLS;

/** `q`の中で、agentが作業の要約から選ぶ1語の自由文を置く位置。 */
export const MCP_AGENT_QUERY_WORD = "<word>";

/** `<word>`に置ける語。空白と`:`を含まず、`-`で始まらない。 */
export const MCP_AGENT_QUERY_WORD_PATTERN = "^[^\\s:-][^\\s:]*$";

/** agentが`list_issues`の`q`として送る文字列。 */
export const MCP_AGENT_QUERIES = [
	`-status:resolved,not_planned ${MCP_AGENT_QUERY_WORD}`,
] as const;

/**
 * 結果のschemaを、未知の項目を許す開いたobjectへ写す（本体の検査が使う）。入れ子のobjectと配列の要素にも当てる。
 * 本体が結果に項目を加えても契約を破らないようにするためである（read-api.md「互換性」の未知のfieldを無視する規則）。
 */
export function openResult<T>(schema: T): T {
	return open(schema) as T;
}

// TypeBoxの型の印（symbolのkey）も写し、TypeBoxのvalidatorでも同じschemaとして読めるようにする。
function open(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(open);
	if (typeof value !== "object" || value === null) return value;
	const opened: Record<PropertyKey, unknown> = {};
	for (const key of Reflect.ownKeys(value)) {
		if (key === "additionalProperties") continue;
		opened[key] = open((value as Record<PropertyKey, unknown>)[key]);
	}
	return opened;
}
