import { compileSchema } from "@harnessforce/test-support/validator";
import { describe, expect, it } from "vitest";
import {
	ACTIVITY_EVENT_TYPES,
	IngestEventSchema,
} from "../src/schemas/ingest-items.js";
import { ingestEvent } from "./support/fixtures.js";

const event = compileSchema(IngestEventSchema);

describe("ingest event", () => {
	it("accepts exactly the event types of activity_events", () =>
		expect(ACTIVITY_EVENT_TYPES).toEqual([
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
			"run.started",
			"run.completed",
			"config.changed",
			"evaluation.recorded",
		]));
	it("accepts the example", () => expect(event(ingestEvent)).toBe(true));
	it.each([
		["unknown event_type", { event_type: "deploy.done" }],
		["unknown actor_type", { actor_type: "bot" }],
		["unknown entity type", { entity: { type: "ticket", id: "1" } }],
		["offset-less occurred_at", { occurred_at: "2026-09-26T04:00:00" }],
	])("rejects %s", (_, patch) =>
		expect(event({ ...ingestEvent, ...patch })).toBe(false),
	);
});
