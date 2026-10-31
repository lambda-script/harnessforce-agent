# @harnessforce/cli

## 0.3.0

### Minor Changes

- 8b348fd: Redirect the browser to the Harnessforce completion screen after `harnessforce init`. The loopback holds its response until the result is known, then answers with a 303 to `/cli/connected` with a fixed status. The code, the state, and the error description are never put in the URL.
- 576af6c: `harnessforce init` now reads the Workspace's content settings (`content`) from the credentials response and writes the four Claude Code content variables (`OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_ASSISTANT_RESPONSES`, `OTEL_LOG_TOOL_DETAILS`, `OTEL_LOG_TOOL_CONTENT`) as `1` for the categories you send with `--send-content` and the Workspace stores, and as an explicit `0` otherwise. It writes Codex's `log_user_prompt` and `log_agent_responses` the same way. It prints which categories are on, who can read them and the retention days. `/harnessforce:setup` now offers to send content with "send" selected by default.
- a8d81f3: Link runs to the pull requests of the branches a session moves to. The Claude Code plugin hooks (`CwdChanged`, `Stop`, and `PostToolUse` for `Write` and `Edit`) and the Codex hooks (`harnessforce hook post-tool-use` for `apply_patch` and `harnessforce hook stop`) record the repository and branch of each Git working tree the session works in, and send them to `/v1/sessions/locations` at the end of a turn in which they changed. Only the agent, the session ID and up to 10 pairs of repository and branch are sent, never paths, commits, file names or the content of edits. `harnessforce init` now writes the two Codex hooks too; run it again and trust the hooks in `/hooks`. `@harnessforce/semconv` adds the `session-work-location` schema.

### Patch Changes

- 8e23e58: When the workspace has reached its ingest key limit, `harnessforce init` now tells owners and admins to ask members to revoke unused keys in My ingest keys on their account page. The workspace settings no longer list every key.
- 8b348fd: `harnessforce init` no longer ends the login when its loopback receives a callback without the expected `state`, which another local process or a web page can send. That request is sent to the failure screen, and the loopback keeps waiting for the real callback until the timeout. A request the loopback cannot parse, such as `GET //`, now gets a 400 response instead of stopping the CLI.
- Updated dependencies [1387922]
- Updated dependencies [a8d81f3]
  - @harnessforce/semconv@0.3.0

## 0.2.0

### Minor Changes

- f440693: Declare the client version on requests to Harnessforce and act on the update status the server returns. A newer version, an upcoming deadline after a security fix, or an unsupported version is shown in one line with the command to update. While a version is unsupported, the CLI and the hooks stop sending to Harnessforce without stopping the agent session, and check again without credentials after 24 hours. `harnessforce init` turns on automatic updates for the Harnessforce plugin marketplace in Claude Code; `harnessforce init --no-plugin-auto-update` turns them off.
- a037024: Make all user-facing text English only: the CLI output, the hook warnings, the loopback page, and the plugin commands, skills, and docs. The consent text of `harnessforce usage-limits on` no longer switches to Japanese by locale.
- 7506e88: Follow the retirement of Plan, Decision, Definition of Done, native Issue creation and usage limits in Harnessforce. The `record-run` skill only starts and completes a Run, and no longer calls `record_plan`, `record_action`, `record_definition_of_done_items` or `create_issue`. `harnessforce usage-limits` and `/harnessforce:usage-limits` are removed, and `/harnessforce:setup` no longer offers to share usage limits. `@harnessforce/semconv` drops the `hf.cycle.id` attribute. If you ran `harnessforce usage-limits on` earlier, restore the `statusLine` in your Claude Code user settings by hand.
- 67f9a81: `harnessforce --help` now lists every command with a one-line description, and `harnessforce <command> --help` explains when to use it, what it does, what it sends and does not send, its exit codes, and examples.
- 3079a53: When telemetry cannot be sent, the session now says why in one line at its start, with the fix: no ingest key in the keychain, a keychain that could not be read, a destination that differs from the one `harnessforce init` saved, or missing Claude Code telemetry settings. Codex shows its warnings in its UI through `systemMessage` instead of plain text. `harnessforce otel-headers` exits 3 when there is no key and 4 when it withholds the key, and on Linux moves a key kept in the kernel keyring to an unlocked Secret Service so a reboot no longer loses it.

### Patch Changes

- d51b667: `harnessforce init --url` no longer appears in the usual `--help` output, because customers only connect to the default Harnessforce service. The option still works when given. When `init` connects somewhere other than the default, it now prints the destination so you can notice it.
- 337b7e6: `harnessforce import` now says why sessions were not imported: it counts them as already sent, outside the import window, outside a git repository, or in a repository not connected to the Workspace, and asks you to connect the repository with the GitHub App when that left nothing to import.
- 33bcd76: Leave the values that can carry credentials out of the hook and MCP server hashes in the config snapshot: `env` and `headers` values, `args`, and the userinfo, query and fragment of URLs. `harnessforce tune record` hashes hook and MCP server proposals the same way. Hook and MCP server versions change once after the update.
- 658c8f1: `harnessforce tune` now restarts without the TLS and proxy runtime variables (`NODE_TLS_REJECT_UNAUTHORIZED`, `NODE_OPTIONS`, `HTTPS_PROXY`, and the others) before it sends analysis results, as the other commands that send keys or tokens already do. `harnessforce tune` also writes MCP server names and model names to the terminal as printable ASCII only: the text output shows other characters as `\u{..}`, and `--json` and `--show-report` write them as JSON `\u` escapes, so the values parse the same.
- Updated dependencies [7506e88]
  - @harnessforce/semconv@0.2.0

## 0.1.1

### Patch Changes

- 9fec25a: `harnessforce init` on Linux now saves to the kernel keyring when the Secret Service cannot be used (for example over SSH or with a locked KWallet), waits at most 60 seconds for an unlock prompt, and names both stores when neither works.
