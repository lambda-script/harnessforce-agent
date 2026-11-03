import { describe, expect, it } from "vitest";
import { sessionContext, sessionContextLine } from "../src/session-context.js";
import { usingHarnessforceBody } from "../src/using-harnessforce.js";

// correlation.md「session context」: pluginのhookとCodexのhookが、同じ行と同じ形のJSONで session IDをagentのcontextへ渡す。
describe("session context", () => {
	it("is the line the record-session skill reads", () =>
		expect(sessionContextLine("sess-1")).toBe(
			"harnessforce agent_session_id: sess-1",
		));

	it("is the SessionStart additionalContext object", () =>
		expect(sessionContext("sess-1")).toEqual({
			hookSpecificOutput: {
				hookEventName: "SessionStart",
				additionalContext: `harnessforce agent_session_id: sess-1\n\n${usingHarnessforceBody}`,
			},
		}));
});
