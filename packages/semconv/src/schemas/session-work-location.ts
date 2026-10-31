import { type Static, Type } from "@sinclair/typebox";
import { Agent, closed, RepositorySlug, schemaId, Token } from "./common.js";

// semantic-conventions.md「Session work location」: 1つの要素が持つ組の上限。
export const MAX_WORK_LOCATIONS = 10;

export const WorkLocationPairSchema = Type.Object(
	{ repository: RepositorySlug, branch: Token() },
	closed,
);
export type WorkLocationPair = Static<typeof WorkLocationPairSchema>;

// pathとcommitを持たせない。同じ組を重ねない。
export const SessionWorkLocationSchema = Type.Object(
	{
		agent: Agent,
		session_id: Token(),
		locations: Type.Array(WorkLocationPairSchema, {
			minItems: 1,
			maxItems: MAX_WORK_LOCATIONS,
			uniqueItems: true,
		}),
	},
	{ $id: schemaId("session-work-location"), ...closed },
);
export type SessionWorkLocation = Static<typeof SessionWorkLocationSchema>;
