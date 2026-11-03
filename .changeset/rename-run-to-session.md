---
"@harnessforce/semconv": minor
"@harnessforce/cli": minor
"@harnessforce/claude-code-plugin": minor
---

Harnessforce calls the record of an agent's work on an Issue a Session, and the agent's own session ID the agent session ID.

- The session registration, session import, session work location, config snapshot, analysis report and session usage summary schemas name the agent's session ID `agent_session_id` instead of `session_id`. The ingest event uses the event types `session.started` and `session.completed` and the entity type `session` instead of `run.started`, `run.completed` and `run`.
- The SessionStart hooks add `harnessforce agent_session_id: <agent_session_id>` to the context instead of `harnessforce session_id: <session_id>`.
- The `record-run` skill is now `record-session`. It registers the Session with the MCP tool `start_session` (input `agent_session_id`) and closes it with `complete_session` (input `session_id`), which replace `start_run` and `complete_run`.
- `harnessforce tune --json` writes `agent_session_id` for each analyzed session, and `harnessforce tune record` takes `evidence_agent_session_ids` and writes `attributed_agent_session_id`. `harnessforce top --json` writes `agent_session_id`.
- `/harnessforce:setup` says "Your first session arrived." when step 5 is done.
