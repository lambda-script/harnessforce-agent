import { usingHarnessforceBody } from "./using-harnessforce.js";

// correlation.md「session context」: skillが`start_session`へ渡すsession IDを、session registrationと同じ値でcontextへ加える。
// pluginのhookとCodexのhook（`harnessforce hook session-start`）が同じ行を出す。
export const sessionContextLine = (sessionId: string): string =>
	`harnessforce agent_session_id: ${sessionId}`;

export const sessionContext = (sessionId: string) => ({
	hookSpecificOutput: {
		hookEventName: "SessionStart",
		additionalContext: `${sessionContextLine(sessionId)}\n\n${usingHarnessforceBody}`,
	},
});
