# @harnessforce/semconv

## 0.5.0

### Minor Changes

- 1d367ab: Harnessforce calls the record of an agent's work on an Issue a Session, and the agent's own session ID the agent session ID.
  
  - The session registration, session import, session work location, config snapshot, analysis report and session usage summary schemas name the agent's session ID `agent_session_id` instead of `session_id`. The ingest event uses the event types `session.started` and `session.completed` and the entity type `session` instead of `run.started`, `run.completed` and `run`.
  - The SessionStart hooks add `harnessforce agent_session_id: <agent_session_id>` to the context instead of `harnessforce session_id: <session_id>`.
  - The `record-run` skill is now `record-session`. It registers the Session with the MCP tool `start_session` (input `agent_session_id`) and closes it with `complete_session` (input `session_id`), which replace `start_run` and `complete_run`.
  - `harnessforce tune --json` writes `agent_session_id` for each analyzed session, and `harnessforce tune record` takes `evidence_agent_session_ids` and writes `attributed_agent_session_id`. `harnessforce top --json` writes `agent_session_id`.
  - `/harnessforce:setup` says "Your first session arrived." when step 5 is done.

## 0.4.0

### Minor Changes

- 343f205: The `ingest-event` schema now requires `project_key`, as the Event table of the semantic conventions does.
  
  A token's length is now counted in Unicode code points by every validator. The limit is part of the token
  `pattern` instead of `maxLength`, so a validator that counts `maxLength` in UTF-16 code units (TypeBox's
  `Value.Check`, for one) no longer rejects a 256 code point token of astral characters.

## 0.3.0

### Minor Changes

- 1387922: Remove what Harnessforce no longer accepts: the `hf.milestone.id`, `hf.plan.id` and `hf.plan.version` attributes, the `plan.updated`, `decision.recorded` and `release.published` event types, and the `ingest-issue` schema (`IngestIssueSchema`, `IngestIssue`, `STATUS_CATEGORIES`). The attributes and event types now match the semantic conventions and `activity_events`.
- a8d81f3: Link runs to the pull requests of the branches a session moves to. The Claude Code plugin hooks (`CwdChanged`, `Stop`, and `PostToolUse` for `Write` and `Edit`) and the Codex hooks (`harnessforce hook post-tool-use` for `apply_patch` and `harnessforce hook stop`) record the repository and branch of each Git working tree the session works in, and send them to `/v1/sessions/locations` at the end of a turn in which they changed. Only the agent, the session ID and up to 10 pairs of repository and branch are sent, never paths, commits, file names or the content of edits. `harnessforce init` now writes the two Codex hooks too; run it again and trust the hooks in `/hooks`. `@harnessforce/semconv` adds the `session-work-location` schema.

## 0.2.0

### Minor Changes

- 7506e88: Follow the retirement of Plan, Decision, Definition of Done, native Issue creation and usage limits in Harnessforce. The `record-run` skill only starts and completes a Run, and no longer calls `record_plan`, `record_action`, `record_definition_of_done_items` or `create_issue`. `harnessforce usage-limits` and `/harnessforce:usage-limits` are removed, and `/harnessforce:setup` no longer offers to share usage limits. `@harnessforce/semconv` drops the `hf.cycle.id` attribute. If you ran `harnessforce usage-limits on` earlier, restore the `statusLine` in your Claude Code user settings by hand.
