import { type Static, Type } from "@sinclair/typebox";
import {
	Agent,
	CommitSha,
	closed,
	Instant,
	RepositorySlug,
	schemaId,
	Token,
} from "./common.js";

export const REGISTRATION_SOURCES = ["hook", "cli", "mcp", "import"] as const;

export const registrationProperties = {
	agent: Agent,
	session_id: Token(),
	first_prompt_id: Type.Optional(Token()),
	repository: Type.Optional(RepositorySlug),
	branch: Type.Optional(Token()),
	commit: Type.Optional(CommitSha),
	issue_identifier: Type.Optional(Token(64)),
	source: Type.Union(REGISTRATION_SOURCES.map((s) => Type.Literal(s))),
	started_at: Instant,
};

export const SessionRegistrationSchema = Type.Object(registrationProperties, {
	$id: schemaId("session-registration"),
	...closed,
});
export type SessionRegistration = Static<typeof SessionRegistrationSchema>;
