import { describe, expect, it } from "vitest";
import {
	COMPONENT_KINDS,
	ConfigSnapshotSchema,
} from "../src/schemas/config-snapshot.js";
import { configSnapshot } from "./support/fixtures.js";
import { compile } from "./support/validator.js";

const check = compile(ConfigSnapshotSchema);
const withComponent = (c: object) => ({ ...configSnapshot, components: [c] });

describe("config snapshot", () => {
	it("accepts the example", () => expect(check(configSnapshot)).toBe(true));

	it("fixes the component kinds", () =>
		expect(COMPONENT_KINDS).toEqual([
			"skill",
			"rule",
			"agent",
			"command",
			"hook",
			"permissions",
			"mcp_server",
			"model",
			"workflow",
		]));

	it.each([
		[
			"unknown kind",
			withComponent({
				kind: "plugin",
				id: "x",
				source: "repository",
				hash: "a".repeat(64),
			}),
		],
		[
			"file body instead of hash",
			withComponent({
				kind: "rule",
				id: "x",
				source: "repository",
				hash: "a".repeat(64),
				body: "# rule",
			}),
		],
		[
			"non-hex hash",
			withComponent({
				kind: "rule",
				id: "x",
				source: "repository",
				hash: "not-a-hash",
			}),
		],
		[
			"unknown component source",
			withComponent({
				kind: "rule",
				id: "x",
				source: "team",
				hash: "a".repeat(64),
			}),
		],
		[
			"missing component source",
			withComponent({ kind: "rule", id: "x", hash: "a".repeat(64) }),
		],
		["empty components", { ...configSnapshot, components: [] }],
	])("rejects %s", (_, value) => expect(check(value)).toBe(false));
});
