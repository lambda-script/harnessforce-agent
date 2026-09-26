import { describe, expect, it } from "vitest";
import {
	ATTR,
	EXECUTION_ACTOR_TYPES,
	EXECUTION_MODES,
} from "../src/attributes.js";

describe("hf.* attributes", () => {
	it("exposes every attribute defined in semantic conventions", () => {
		expect(Object.values(ATTR).sort()).toEqual(
			[
				"hf.workspace.id",
				"hf.project.id",
				"hf.project.key",
				"hf.milestone.id",
				"hf.cycle.id",
				"hf.issue.id",
				"hf.issue.identifier",
				"hf.plan.id",
				"hf.plan.version",
				"hf.agent.config_version",
				"hf.execution.mode",
				"hf.execution.actor_type",
				"hf.execution.actor_id",
				"hf.vcs.repository",
				"hf.vcs.branch",
				"hf.vcs.commit",
				"hf.sdk.name",
				"hf.sdk.version",
			].sort(),
		);
	});

	it("keeps every name inside the hf.* namespace", () => {
		for (const name of Object.values(ATTR))
			expect(name).toMatch(/^hf\.[a-z_]+(\.[a-z_]+)+$/);
	});

	it("fixes the execution vocabularies", () => {
		expect(EXECUTION_MODES).toEqual(["human", "ai", "hybrid"]);
		expect(EXECUTION_ACTOR_TYPES).toEqual([
			"user",
			"agent",
			"integration",
			"system",
		]);
	});
});
