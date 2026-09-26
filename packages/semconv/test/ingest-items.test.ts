import { describe, expect, it } from "vitest";
import {
	IngestEventSchema,
	IngestIssueSchema,
} from "../src/schemas/ingest-items.js";
import { ingestEvent, ingestIssue } from "./support/fixtures.js";
import { compile } from "./support/validator.js";

const issue = compile(IngestIssueSchema);
const event = compile(IngestEventSchema);

describe("ingest issue", () => {
	it("accepts the example", () => expect(issue(ingestIssue)).toBe(true));
	it.each([
		["unknown status_category", { status_category: "in_review" }],
		["due_on as an instant", { due_on: "2026-10-01T00:00:00Z" }],
		[
			"offset-less source_updated_at",
			{ source_updated_at: "2026-09-26T03:00:00" },
		],
		["unknown field", { origin: "native" }],
	])("rejects %s", (_, patch) =>
		expect(issue({ ...ingestIssue, ...patch })).toBe(false));
	it("requires external_id", () => {
		const { external_id, ...rest } = ingestIssue;
		expect(issue(rest)).toBe(false);
	});
	it("requires project_key", () => {
		const { project_key, ...rest } = ingestIssue;
		expect(issue(rest)).toBe(false);
	});
});

describe("ingest event", () => {
	it("accepts the example", () => expect(event(ingestEvent)).toBe(true));
	it.each([
		["unknown event_type", { event_type: "deploy.done" }],
		["unknown actor_type", { actor_type: "bot" }],
		["unknown entity type", { entity: { type: "ticket", id: "1" } }],
		["offset-less occurred_at", { occurred_at: "2026-09-26T04:00:00" }],
	])("rejects %s", (_, patch) =>
		expect(event({ ...ingestEvent, ...patch })).toBe(false));
});
