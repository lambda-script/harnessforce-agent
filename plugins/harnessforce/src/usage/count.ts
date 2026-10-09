import { isObject } from "@harnessforce/agent-core/object";
import { identifierOfName, mcpServerOfTool } from "./names.js";
import type { Identifiers, RecordLine } from "./store.js";

// correlation.md「数えるhook」。hookの入力のうち、名前を決めるのに要る項目（Skill toolの`skill`、Agent toolの
// `subagent_type`、tool名、`command_name`）と圧縮の契機だけを読む（privacy-and-retention.md「sessionの利用の要約」）。
export const COUNTING_EVENTS = [
	"post-tool-use",
	"post-tool-use-failure",
	"user-prompt-expansion",
	"permission-request",
	"post-compact",
] as const;
type CountingEvent = (typeof COUNTING_EVENTS)[number];
type Counted = Pick<RecordLine, "kind" | "id" | "failed" | "trigger">;
type Fields = Record<string, unknown>;

const named = (kind: Counted["kind"], id: string | undefined): Counted =>
	id === undefined ? { kind } : { kind, id };
const stringOf = (value: unknown) =>
	typeof value === "string" ? value : undefined;

function toolCall(fields: Fields, identifiers: Identifiers) {
	const tool = stringOf(fields.tool_name);
	const input = isObject(fields.tool_input) ? fields.tool_input : {};
	if (tool === "Skill") {
		const skill = stringOf(input.skill)?.replace(/^\//, "");
		return named(
			"skill",
			skill === undefined
				? undefined
				: identifierOfName(skill, identifiers.skill),
		);
	}
	// subagentはAgent toolの1回の呼び出しを1回と数える。SubagentStartは再開でも発火するため使わない。
	if (tool === "Agent" || tool === "Task") {
		const type = stringOf(input.subagent_type);
		return named(
			"subagent",
			type === undefined
				? undefined
				: identifierOfName(type, identifiers.agent),
		);
	}
	// v2.1.274以降の`mcp_server`は使わず、古いversionでも同じ規則で数えるためtool名から求める。
	if (tool?.startsWith("mcp__"))
		return named("mcp", mcpServerOfTool(tool, identifiers.mcp_server));
	return undefined;
}

// commandの`/<名前>`はskillも起動するため、skillとcommandの識別子を候補とする。
function commandCall(fields: Fields, identifiers: Identifiers) {
	if (fields.expansion_type === "mcp_prompt")
		return named("command", undefined);
	if (fields.expansion_type !== "slash_command") return undefined;
	const name = stringOf(fields.command_name);
	return named(
		"command",
		name === undefined
			? undefined
			: identifierOfName(name, [...identifiers.skill, ...identifiers.command]),
	);
}

// 数えないeventの入力ではundefinedを返す。
export function countedOf(
	event: CountingEvent,
	fields: Fields,
	identifiers: Identifiers,
): Counted | undefined {
	switch (event) {
		case "post-tool-use":
			return toolCall(fields, identifiers);
		case "post-tool-use-failure": {
			const call = toolCall(fields, identifiers);
			return call && { ...call, failed: true };
		}
		case "user-prompt-expansion":
			return commandCall(fields, identifiers);
		case "permission-request":
			return { kind: "permission" };
		case "post-compact":
			return fields.trigger === "auto" || fields.trigger === "manual"
				? { kind: "compaction", trigger: fields.trigger }
				: undefined;
	}
}
