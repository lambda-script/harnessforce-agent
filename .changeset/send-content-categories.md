---
"@harnessforce/cli": minor
"@harnessforce/claude-code-plugin": minor
---

`harnessforce init` now reads the Workspace's content settings (`content`) from the credentials response and writes the four Claude Code content variables (`OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_ASSISTANT_RESPONSES`, `OTEL_LOG_TOOL_DETAILS`, `OTEL_LOG_TOOL_CONTENT`) as `1` for the categories you send with `--send-content` and the Workspace stores, and as an explicit `0` otherwise. It writes Codex's `log_user_prompt` and `log_agent_responses` the same way. It prints which categories are on, who can read them and the retention days. `/harnessforce:setup` now offers to send content with "send" selected by default.
