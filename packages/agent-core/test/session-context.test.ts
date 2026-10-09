import { describe, expect, it } from "vitest";
import { sessionContext, sessionContextLine } from "../src/session-context.js";

// correlation.md「session context」: pluginのhookとCodexのhookが、同じ行と同じ形のJSONで session IDをagentのcontextへ渡す。
describe("session context", () => {
	it("is the line the record-run skill reads", () =>
		expect(sessionContextLine("sess-1")).toBe(
			"harnessforce session_id: sess-1",
		));

	it("is the SessionStart additionalContext object", () =>
		expect(sessionContext("sess-1")).toEqual({
			hookSpecificOutput: {
				hookEventName: "SessionStart",
				additionalContext: "harnessforce session_id: sess-1",
			},
		}));
});
