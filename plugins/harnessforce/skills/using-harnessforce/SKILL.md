---
name: using-harnessforce
description: Use when starting a session in an environment with the Harnessforce hook, when starting work on an Issue, or when asked what is recorded or collected. The hook injects this text into the context at session start.
---

# Using Harnessforce

This session has the Harnessforce hook installed. Harnessforce links the work of people and AI to Issues and records it. Follow these rules.

## What is recorded

- Session registration: agent, session ID, repository, branch, commit, start time, and the first prompt ID.
- Config snapshot: the structure of the configuration in use (Claude Code only).
- OTel telemetry: what the user chooses to send.
- For work on an Issue, `record-run` records the Plan, the Decision, proposed Definition of Done items, and whether the Definition of Done is met. Nothing is final until a person approves it.

## What is not collected

- Prompts, responses, tool input and output, and the body of code diffs arrive only when the user opts in with `--send-content` and the Workspace has opted in. They are not collected by default.
- Never put these contents, secrets, or environment variable values in MCP tool input or in a record.

## Which hook sends what

- SessionStart: session registration and the config snapshot (Codex sends session registration only).
- UserPromptSubmit: resends on the first prompt (Claude Code only).
- A failing hook never stops the session. When the hook cannot send, it shows a one-line warning. Tell the user when a warning appears.

## Which skill and tool to use, and when

- For work on a specified Issue ID, or when the environment variable `HARNESSFORCE_ISSUE` is set, follow `record-run` and use `start_run`, `get_issue`, `propose_definition_of_done_items` (only when the Definition of Done is empty), `record_plan`, `record_action`, and `complete_run`. An agent that cannot load the skill calls the tools in the same order.
- Pass the value of the `harnessforce session_id:` line in the context to `start_run`. If there are several, use the last one. If the line is missing, do not guess the session ID, and do not call `start_run` or `complete_run`.
- Use `propose-improvements` for the analysis of `/harnessforce:tune`.
- When no Issue is specified, do not start recording a Run.

## Red Flags

Stop when one of these thoughts comes up.

| Thought | Reality |
| --- | --- |
| An Issue was specified, but the work is small, so recording is unnecessary | Work on a specified Issue is recorded regardless of its size |
| The session ID line is missing, so I will guess it and call `start_run` | Do not guess. The Run would no longer be linked to the session |
| Summarizing the content before recording would help | Do not pass content to the tool. It goes beyond what is collected |
| A warning appeared, but I can ignore it | Sending is not working. Tell the user |

## Priority

1. The user's instructions (CLAUDE.md, AGENTS.md, direct requests). If the user tells you to stop recording, stop recording the Run.
2. This introduction.
3. Default behavior.

## Subagents

A subagent that was delegated only a specific task by its parent does not register a Run by following this introduction. The parent registers the Run.
