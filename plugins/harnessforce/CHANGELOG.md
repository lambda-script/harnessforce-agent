# @harnessforce/claude-code-plugin

## 0.6.0

### Minor Changes

- f66fbd3: The CLI commands now use the common names. `harnessforce init` is `harnessforce login`, and `harnessforce tune` is `harnessforce insights` (`--report-only` is `--quiet`, `--print-schedule` is `insights schedule`, `--purge` is `insights clear`, and `tune record` is `insights record`). It keeps its files in `~/.harnessforce/insights/` and reads `insights.send_report`; the old `tune` files and setting are not read. The old names are removed. `harnessforce logout` revokes this machine's ingest key and login and removes the settings `login` wrote. Whether this machine sends prompts and responses is now `harnessforce config set send-content on|off` instead of `login --send-content`, and logging in again keeps that choice. `harnessforce login` says what it waits for and how to cancel before opening the browser, exits 130 on Ctrl+C, and ends with the next command to run. Not being logged in and a changed destination now have their own messages. `/harnessforce:tune` is `/harnessforce:insights`, and the plugin needs CLI 0.7.0.
- a869991: `harnessforce` now answers a bad argument with what is wrong and the usage of that command, and exits 2 (`otel-headers` and `hook` still exit 1). An unknown command suggests the closest one (`harnessforce stauts` → `Did you mean "status"?`), and `harnessforce` with no command prints the overview help. `harnessforce --help` lists the commands your agents run (`otel-headers`, `hook`, `insights record`) apart from yours. `harnessforce top --once` no longer prints the key hints of the live view. `harnessforce status` names each of `claude` and `codex` that is older than the oldest version the Harnessforce hooks support, and `--json` adds `outdated_agents`. `/harnessforce:status` now shows the connection status from `harnessforce status` before the sessions on this machine, and `/harnessforce:run` is removed: `/harnessforce:help` explains running `harnessforce run` in a terminal.
- 2c694e7: Add the experimental `diagram` skill (`/harnessforce:diagram`), which draws architecture, CI/CD, state, error-flow, ER, Gantt and sequence diagrams of a repository in Mermaid and renders them with product logos. Rendering downloads mermaid-cli and Chromium on first use, and the logos come from public icon sites.
- c1c8b21: The introduction that the Harnessforce hook adds to every Claude Code and Codex session now tells the agent which Harnessforce skill to use for which request (including the `diagram` skill), lists every hook with what it sends (it had left out the usage summary sent at session end), says that Codex telemetry carries tool arguments and results, and names more of the mistakes to stop at.

## 0.5.1

### Patch Changes

- 6a297bd: Name the session and the Workspace in the messages people see. `harnessforce status` and `/harnessforce:setup` title step 5 "Wait for your first session", the hooks say "The Workspace's ingest key has been revoked" for a revoked Workspace key, and `harnessforce init --help` says that the Codex `config.toml` holds the user ingest key in plain text.

## 0.5.0

### Minor Changes

- 1d367ab: Harnessforce calls the record of an agent's work on an Issue a Session, and the agent's own session ID the agent session ID.
  
  - The session registration, session import, session work location, config snapshot, analysis report and session usage summary schemas name the agent's session ID `agent_session_id` instead of `session_id`. The ingest event uses the event types `session.started` and `session.completed` and the entity type `session` instead of `run.started`, `run.completed` and `run`.
  - The SessionStart hooks add `harnessforce agent_session_id: <agent_session_id>` to the context instead of `harnessforce session_id: <session_id>`.
  - The `record-run` skill is now `record-session`. It registers the Session with the MCP tool `start_session` (input `agent_session_id`) and closes it with `complete_session` (input `session_id`), which replace `start_run` and `complete_run`.
  - `harnessforce tune --json` writes `agent_session_id` for each analyzed session, and `harnessforce tune record` takes `evidence_agent_session_ids` and writes `attributed_agent_session_id`. `harnessforce top --json` writes `agent_session_id`.
  - `/harnessforce:setup` says "Your first session arrived." when step 5 is done.

### Patch Changes

- f101fc9: The Codex `SessionStart` hook now warns "Codex is sending telemetry to Harnessforce every second. Start Codex with `harnessforce run -- codex` to send it every minute" when the `[otel]` exporter in Codex's `config.toml` sends to Harnessforce and `OTEL_BLRP_SCHEDULE_DELAY` is missing or not an integer of at least 60000, that is, when Codex was started without `harnessforce run`. Registration is still sent. The `Stop` hooks of Codex and Claude Code no longer read the ingest key (Claude Code starts `harnessforce otel-headers` for it) in a turn whose repository and branch pairs are the ones already sent.

## 0.4.0

### Minor Changes

- ac0d2e0: Show one line when the installed CLI is older than the plugin needs (CLI 0.4.0 or later). At a session start that registers, the hook runs `harnessforce --version` (up to 1 second) and shows "Harnessforce plugin needs CLI 0.4.0 or later, but CLI <version> is installed. Update it: `npm install -g @harnessforce/cli@latest`" at every start, even with `NO_UPDATE_NOTIFIER` or `CI` set. `/harnessforce:setup` does the same check in step 3, and before step 9 after the restart, and stops at step 3 with the same line. Neither updates the CLI, and sending does not stop. The local marketplace build, which installs the CLI from the same build, does not check.

### Patch Changes

- 8823919: The `record-run` skill now searches candidate Issues with `-status:resolved,not_planned <word>`. The previous `-status:done,canceled` used statuses that Issues no longer have, so `list_issues` rejected the query and no candidate was shown. The skill also says that the first MCP login chooses a Workspace and a Project.
- 9a23ee7: `/harnessforce:setup` passes on, as it is, the line `harnessforce init` prints when it repairs the status line left by the retired `harnessforce usage-limits` command.

## 0.3.1

### Patch Changes

- c8ccda0: `/harnessforce:setup` can now be started by the agent when you ask it to set up Harnessforce, ends only with the defined last lines (including where it stopped), shows the remaining workspace steps from `harnessforce status --json`, keeps going when the import fails, explains an `EACCES` npm install failure, updates an unsupported CLI, and asks Codex users to trust the `SessionStart`, `PostToolUse` and `Stop` hooks in `/hooks`. The `record-run` skill no longer passes the repository, branch or commit to `start_run`, and offers once to link committing work without an Issue to an existing Issue. `harnessforce otel-headers --help` lists the exit codes 3, 4, 5 and 1, and `harnessforce import --help` says that only Codex sessions send the commit.

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
