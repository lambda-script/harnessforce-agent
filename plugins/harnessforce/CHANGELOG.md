# @harnessforce/claude-code-plugin

## 0.3.0

### Minor Changes

- 576af6c: `harnessforce init` now reads the Workspace's content settings (`content`) from the credentials response and writes the four Claude Code content variables (`OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_ASSISTANT_RESPONSES`, `OTEL_LOG_TOOL_DETAILS`, `OTEL_LOG_TOOL_CONTENT`) as `1` for the categories you send with `--send-content` and the Workspace stores, and as an explicit `0` otherwise. It writes Codex's `log_user_prompt` and `log_agent_responses` the same way. It prints which categories are on, who can read them and the retention days. `/harnessforce:setup` now offers to send content with "send" selected by default.
- a8d81f3: Link runs to the pull requests of the branches a session moves to. The Claude Code plugin hooks (`CwdChanged`, `Stop`, and `PostToolUse` for `Write` and `Edit`) and the Codex hooks (`harnessforce hook post-tool-use` for `apply_patch` and `harnessforce hook stop`) record the repository and branch of each Git working tree the session works in, and send them to `/v1/sessions/locations` at the end of a turn in which they changed. Only the agent, the session ID and up to 10 pairs of repository and branch are sent, never paths, commits, file names or the content of edits. `harnessforce init` now writes the two Codex hooks too; run it again and trust the hooks in `/hooks`. `@harnessforce/semconv` adds the `session-work-location` schema.

## 0.2.0

### Minor Changes

- f440693: Declare the client version on requests to Harnessforce and act on the update status the server returns. A newer version, an upcoming deadline after a security fix, or an unsupported version is shown in one line with the command to update. While a version is unsupported, the CLI and the hooks stop sending to Harnessforce without stopping the agent session, and check again without credentials after 24 hours. `harnessforce init` turns on automatic updates for the Harnessforce plugin marketplace in Claude Code; `harnessforce init --no-plugin-auto-update` turns them off.
- a037024: Make all user-facing text English only: the CLI output, the hook warnings, the loopback page, and the plugin commands, skills, and docs. The consent text of `harnessforce usage-limits on` no longer switches to Japanese by locale.
- f68d5b9: Add the `/harnessforce:status`, `/harnessforce:import`, `/harnessforce:usage-limits`, `/harnessforce:run` and `/harnessforce:help` commands, which wrap the `harnessforce` CLI inside a Claude Code session. `/harnessforce:status` summarizes `harnessforce top --once --json`; `/harnessforce:usage-limits` only shows the state and leaves turning sharing on or off to you.
- 7506e88: Follow the retirement of Plan, Decision, Definition of Done, native Issue creation and usage limits in Harnessforce. The `record-run` skill only starts and completes a Run, and no longer calls `record_plan`, `record_action`, `record_definition_of_done_items` or `create_issue`. `harnessforce usage-limits` and `/harnessforce:usage-limits` are removed, and `/harnessforce:setup` no longer offers to share usage limits. `@harnessforce/semconv` drops the `hf.cycle.id` attribute. If you ran `harnessforce usage-limits on` earlier, restore the `statusLine` in your Claude Code user settings by hand.
- 3079a53: When telemetry cannot be sent, the session now says why in one line at its start, with the fix: no ingest key in the keychain, a keychain that could not be read, a destination that differs from the one `harnessforce init` saved, or missing Claude Code telemetry settings. Codex shows its warnings in its UI through `systemMessage` instead of plain text. `harnessforce otel-headers` exits 3 when there is no key and 4 when it withholds the key, and on Linux moves a key kept in the kernel keyring to an unlocked Secret Service so a reboot no longer loses it.

### Patch Changes

- b21372c: Make the `record-run` and `using-harnessforce` skills add Definition of Done items with `record_definition_of_done_items` when the Issue has none, so a person only has to review them.
- c3a4521: Rename the MCP tool `record_decision` to `record_action` in the `record-run` and `using-harnessforce` skills, so the agent calls the tool under the name the Harnessforce server now exposes.
- bb5873b: Make the `record-run` skill record the user's decisions (choosing an option, approving or rejecting a plan, setting scope) as Actions without asking.
- 33bcd76: Leave the values that can carry credentials out of the hook and MCP server hashes in the config snapshot: `env` and `headers` values, `args`, and the userinfo, query and fragment of URLs. `harnessforce tune record` hashes hook and MCP server proposals the same way. Hook and MCP server versions change once after the update.
- 337b7e6: `/harnessforce:setup` now relays the reasons and the next step that `harnessforce import` prints when it imports nothing.
