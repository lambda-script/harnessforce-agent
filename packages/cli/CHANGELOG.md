# @harnessforce/cli

## 0.7.3

### Patch Changes

- 0e7edb2: `harnessforce login` now ends by pointing at the page that assigns repositories to a project while the Workspace has none assigned, instead of suggesting `harnessforce import`, which imports nothing until a repository is assigned.
- eb5b69d: When `start_session` returns `forbidden` or `conflict` (this session belongs to another user), the record-session skill now tells the user why the work cannot be linked and continues without calling `start_session` again, calling `complete_session`, or guessing another session ID, for an Issue the user named as well as one picked from the candidates. A `forbidden` or `conflict` from `complete_session` is reported and not retried. The injected introduction lists this as a Red Flag.

## 0.7.2

### Patch Changes

- 6e76b3c: A machine that never chose whether to send content now sends it. When `~/.harnessforce/config.json` is missing or has no `send_content` key, `harnessforce login` writes the content variables as `1` for the categories the Workspace stores, and `harnessforce config get send-content` prints `on`. Run `harnessforce config set send-content off` to stop; `harnessforce login` keeps that choice. A file that cannot be read, is not a JSON object, or has a `send_content` that is not a boolean still means off. The message after content is turned on now ends with how to stop, and `harnessforce login` adds the managed settings line when the organization's managed settings also set the content variables. The plugin's setup, help and injected introduction say that content is sent by default.

## 0.7.1

### Patch Changes

- 8b233a2: `harnessforce otel-headers` now checks the destination before it prints the Workspace key from the managed settings file, as it already did for the user key. It prints the key only when every destination in its environment (`HARNESSFORCE_ENDPOINT` and the `OTEL_EXPORTER_OTLP_*ENDPOINT` variables) has an origin that the managed settings file itself sets, and otherwise exits with code 4 without falling back to the user key. Before Claude Code v2.1.282, a repository's settings could set an OpenTelemetry endpoint that the managed settings file did not, and the Workspace key was sent there. An organization that sends telemetry to its own collector keeps working when the managed settings file sets that collector's endpoint.
- 02b22d4: `harnessforce status` no longer prints terminal control characters or characters that change the text direction from the Workspace name and the setup step links, and `harnessforce run` drops the direction characters from issue titles too. Collecting the configuration now stops reading a file after 1 MiB even when the file reports a size of 0, so a repository that links `CLAUDE.md` to a Linux `/proc` file can no longer make `harnessforce run` or the hooks read without end. The diagram skill's render script no longer starts mermaid-cli on Windows, as its compatibility line already said.

## 0.7.0

### Minor Changes

- f66fbd3: The CLI commands now use the common names. `harnessforce init` is `harnessforce login`, and `harnessforce tune` is `harnessforce insights` (`--report-only` is `--quiet`, `--print-schedule` is `insights schedule`, `--purge` is `insights clear`, and `tune record` is `insights record`). It keeps its files in `~/.harnessforce/insights/` and reads `insights.send_report`; the old `tune` files and setting are not read. The old names are removed. `harnessforce logout` revokes this machine's ingest key and login and removes the settings `login` wrote. Whether this machine sends prompts and responses is now `harnessforce config set send-content on|off` instead of `login --send-content`, and logging in again keeps that choice. `harnessforce login` says what it waits for and how to cancel before opening the browser, exits 130 on Ctrl+C, and ends with the next command to run. Not being logged in and a changed destination now have their own messages. `/harnessforce:tune` is `/harnessforce:insights`, and the plugin needs CLI 0.7.0.
- a869991: `harnessforce` now answers a bad argument with what is wrong and the usage of that command, and exits 2 (`otel-headers` and `hook` still exit 1). An unknown command suggests the closest one (`harnessforce stauts` → `Did you mean "status"?`), and `harnessforce` with no command prints the overview help. `harnessforce --help` lists the commands your agents run (`otel-headers`, `hook`, `insights record`) apart from yours. `harnessforce top --once` no longer prints the key hints of the live view. `harnessforce status` names each of `claude` and `codex` that is older than the oldest version the Harnessforce hooks support, and `--json` adds `outdated_agents`. `/harnessforce:status` now shows the connection status from `harnessforce status` before the sessions on this machine, and `/harnessforce:run` is removed: `/harnessforce:help` explains running `harnessforce run` in a terminal.

### Patch Changes

- c1c8b21: The introduction that the Harnessforce hook adds to every Claude Code and Codex session now tells the agent which Harnessforce skill to use for which request (including the `diagram` skill), lists every hook with what it sends (it had left out the usage summary sent at session end), says that Codex telemetry carries tool arguments and results, and names more of the mistakes to stop at.

## 0.6.1

### Patch Changes

- 6a297bd: Name the session and the Workspace in the messages people see. `harnessforce status` and `/harnessforce:setup` title step 5 "Wait for your first session", the hooks say "The Workspace's ingest key has been revoked" for a revoked Workspace key, and `harnessforce init --help` says that the Codex `config.toml` holds the user ingest key in plain text.

## 0.6.0

### Minor Changes

- f101fc9: The Codex `SessionStart` hook now warns "Codex is sending telemetry to Harnessforce every second. Start Codex with `harnessforce run -- codex` to send it every minute" when the `[otel]` exporter in Codex's `config.toml` sends to Harnessforce and `OTEL_BLRP_SCHEDULE_DELAY` is missing or not an integer of at least 60000, that is, when Codex was started without `harnessforce run`. Registration is still sent. The `Stop` hooks of Codex and Claude Code no longer read the ingest key (Claude Code starts `harnessforce otel-headers` for it) in a turn whose repository and branch pairs are the ones already sent.
- 1d367ab: Harnessforce calls the record of an agent's work on an Issue a Session, and the agent's own session ID the agent session ID.
  
  - The session registration, session import, session work location, config snapshot, analysis report and session usage summary schemas name the agent's session ID `agent_session_id` instead of `session_id`. The ingest event uses the event types `session.started` and `session.completed` and the entity type `session` instead of `run.started`, `run.completed` and `run`.
  - The SessionStart hooks add `harnessforce agent_session_id: <agent_session_id>` to the context instead of `harnessforce session_id: <session_id>`.
  - The `record-run` skill is now `record-session`. It registers the Session with the MCP tool `start_session` (input `agent_session_id`) and closes it with `complete_session` (input `session_id`), which replace `start_run` and `complete_run`.
  - `harnessforce tune --json` writes `agent_session_id` for each analyzed session, and `harnessforce tune record` takes `evidence_agent_session_ids` and writes `attributed_agent_session_id`. `harnessforce top --json` writes `agent_session_id`.
  - `/harnessforce:setup` says "Your first session arrived." when step 5 is done.

### Patch Changes

- Updated dependencies [1d367ab]
  - @harnessforce/semconv@0.5.0

## 0.5.0

### Minor Changes

- 648b256: `harnessforce init` now writes `OTEL_LOGS_EXPORT_INTERVAL`, `OTEL_TRACES_EXPORT_INTERVAL` and `OTEL_METRIC_EXPORT_INTERVAL` as `60000` in the Claude Code user settings, replacing values already there, so Claude Code sends logs and traces once a minute instead of every 5 seconds. Events reach Harnessforce up to a minute later. What is not sent within the exit wait (2 seconds for Claude Code, 500 ms for Codex) can be lost, and so can the last minute when the agent stops without exiting normally. `harnessforce run -- codex` now sets `OTEL_BLRP_SCHEDULE_DELAY=60000` for Codex, replacing the shell's value, so Codex sends logs once a minute instead of every second. A Codex started without `harnessforce run` keeps its default or the shell's value. Codex's `config.toml` is not changed, because it has no key for the interval.

### Patch Changes

- 90bd73a: The `harnessforce import` and `harnessforce tune` help and the README now say that only sessions of repositories assigned to a project are sent, instead of "connected repositories".
- 847ea81: `harnessforce import` now says that sessions were not imported because their repository is not assigned to a project, since Harnessforce stores only sessions of repositories that are connected to the GitHub App and assigned to a project. When nothing was imported for that reason, it asks you to connect the repository to the GitHub App and assign it to a project.
- 9a23ee7: `harnessforce init` now repairs the Claude Code status line left by the retired `harnessforce usage-limits` command. When the user settings' `statusLine.command` starts with `harnessforce usage-limits`, it backs up the settings file (mode 0600), restores the status line recorded in `~/.harnessforce/usage-limits.json`, or removes it when nothing was recorded, and prints one line saying what it did. It then removes the leftover `usage-limits.json` and `usage-limits-state.json`. Other status lines are not touched.
- 57ce086: `harnessforce init` now prints the line about the repaired Claude Code status line, and removes the leftover `usage-limits.json` and `usage-limits-state.json`, as soon as the user settings are written. Before, a failure to write the Codex `config.toml` hid the line and kept the files, even though the status line had already been changed.
- 096da9e: `harnessforce status` now says whether the repository of the current directory is assigned to a project, and the `harnessforce tune` messages about which sessions are not sent now name the repositories assigned to a project, instead of "connected". The `/harnessforce:setup` command tells you to connect the repository to the GitHub App and assign it to a project when its sessions were not imported.
- Updated dependencies [343f205]
  - @harnessforce/semconv@0.4.0

## 0.4.1

### Patch Changes

- ce6ad39: Hooks and `harnessforce otel-headers` no longer ask a locked Secret Service for an unlock. On KDE, those requests piled up behind an unanswered KWallet window and kept the unlock window of `harnessforce init` from appearing. While `harnessforce init` waits for KWallet, it now says which window asks for the password and what to do when none appears.
- c8ccda0: `/harnessforce:setup` can now be started by the agent when you ask it to set up Harnessforce, ends only with the defined last lines (including where it stopped), shows the remaining workspace steps from `harnessforce status --json`, keeps going when the import fails, explains an `EACCES` npm install failure, updates an unsupported CLI, and asks Codex users to trust the `SessionStart`, `PostToolUse` and `Stop` hooks in `/hooks`. The `record-run` skill no longer passes the repository, branch or commit to `start_run`, and offers once to link committing work without an Issue to an existing Issue. `harnessforce otel-headers --help` lists the exit codes 3, 4, 5 and 1, and `harnessforce import --help` says that only Codex sessions send the commit.

## 0.4.0

### Minor Changes

- feb73ac: Add `harnessforce status [--json]`, which shows the connected Workspace, your role, the setup steps that remain with their URLs, and whether the `origin` repository of the current directory is connected to the GitHub App. It only reads, and the remote URL is compared on this machine and never sent. Add `harnessforce tune --report-only [--all]`, which analyzes and sends without writing to stdout, and `harnessforce tune --print-schedule`, which prints a cron line that runs it every Monday at 9:00 local time. Harnessforce never registers the line itself.

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
