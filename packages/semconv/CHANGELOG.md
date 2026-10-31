# @harnessforce/semconv

## 0.3.0

### Minor Changes

- 1387922: Remove what Harnessforce no longer accepts: the `hf.milestone.id`, `hf.plan.id` and `hf.plan.version` attributes, the `plan.updated`, `decision.recorded` and `release.published` event types, and the `ingest-issue` schema (`IngestIssueSchema`, `IngestIssue`, `STATUS_CATEGORIES`). The attributes and event types now match the semantic conventions and `activity_events`.
- a8d81f3: Link runs to the pull requests of the branches a session moves to. The Claude Code plugin hooks (`CwdChanged`, `Stop`, and `PostToolUse` for `Write` and `Edit`) and the Codex hooks (`harnessforce hook post-tool-use` for `apply_patch` and `harnessforce hook stop`) record the repository and branch of each Git working tree the session works in, and send them to `/v1/sessions/locations` at the end of a turn in which they changed. Only the agent, the session ID and up to 10 pairs of repository and branch are sent, never paths, commits, file names or the content of edits. `harnessforce init` now writes the two Codex hooks too; run it again and trust the hooks in `/hooks`. `@harnessforce/semconv` adds the `session-work-location` schema.

## 0.2.0

### Minor Changes

- 7506e88: Follow the retirement of Plan, Decision, Definition of Done, native Issue creation and usage limits in Harnessforce. The `record-run` skill only starts and completes a Run, and no longer calls `record_plan`, `record_action`, `record_definition_of_done_items` or `create_issue`. `harnessforce usage-limits` and `/harnessforce:usage-limits` are removed, and `/harnessforce:setup` no longer offers to share usage limits. `@harnessforce/semconv` drops the `hf.cycle.id` attribute. If you ran `harnessforce usage-limits on` earlier, restore the `statusLine` in your Claude Code user settings by hand.
