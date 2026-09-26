import { describe, expect, it } from "vitest";
import { collectConfig } from "../../src/config/collect.js";
import { fixture } from "./support.js";

describe("collection limits", () => {
	it("skips the snapshot when the deadline has passed", async () => {
		const f = fixture();
		f.project({ "CLAUDE.md": "a", ".claude/rules/b.md": "b" });
		const result = await collectConfig({ ...f.options, isExpired: () => true });
		expect(result).toEqual({ kind: "skipped", reason: "timeout" });
	});

	it("collects exactly 1,000 components but skips 1,001", async () => {
		const rules = (count: number) =>
			Object.fromEntries(
				Array.from({ length: count }, (_, i) => [
					`.claude/rules/r${i}.md`,
					`${i}`,
				]),
			);
		const atLimit = fixture();
		atLimit.project(rules(1000));
		const collected = await collectConfig(atLimit.options);
		expect(collected.kind === "collected" && collected.components).toHaveLength(
			1000,
		);

		const over = fixture();
		over.project(rules(1001));
		expect(await collectConfig(over.options)).toEqual({
			kind: "skipped",
			reason: "too many components",
		});
	}, 20_000);
});
