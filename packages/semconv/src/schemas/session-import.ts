import { type Static, Type } from "@sinclair/typebox";
import { Count, closed, Instant, SemVer, schemaId, Token } from "./common.js";
import { registrationProperties } from "./session-registration.js";

const ToolCallSummary = Type.Object(
	{ tool: Token(128), calls: Count, failures: Count },
	closed,
);

export const SessionImportSchema = Type.Object(
	{
		...registrationProperties,
		source: Type.Literal("import"),
		ended_at: Instant,
		model: Token(128),
		input_tokens: Count,
		output_tokens: Count,
		tool_calls: Type.Array(ToolCallSummary),
		parser_version: SemVer,
	},
	{ $id: schemaId("session-import"), ...closed },
);
export type SessionImport = Static<typeof SessionImportSchema>;
