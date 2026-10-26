---
name: record-run
description: For work on a Harnessforce Issue (an identifier such as ENG-42), use the tools of the Harnessforce MCP server to register this session as a Run and to close the Run when the work ends. Use it when you start work on an Issue and when you finish the work.
---

# Record work on a Harnessforce Issue

Use the tools of the Harnessforce MCP server to link the work to the Issue. The first time you use a tool, you are asked to log in in the browser and choose a Workspace.

## At the start of the work

1. Pass the value of `harnessforce session_id: <session_id>` in the context as `session_id`, and register the Run with `start_run`. The Harnessforce plugin adds this line to the context at session start. If there are several, use the last one added. The input is the Issue identifier (`issue_identifier`), `agent` (`claude_code`), and `session_id`. If you know the repository, branch, and commit you are working on, pass them too. Keep the returned `run_id` until the end. If the line is missing from the context, follow "When the session ID is missing" below.
2. Check the Issue with `get_issue`.

## When the session ID changes

- If the value of the last `harnessforce session_id:` in the context differs from the value you passed to the previous `start_run` (for example after forking the conversation or running `/clear`), call `start_run` once more with the new value before continuing, and use the returned `run_id` for later `complete_run` calls.

## At the end of the work

- Call `complete_run` with the `run_id`.

## When the session ID is missing

- If the context has no `harnessforce session_id:` line, do not guess and pass a session ID, and do not call `start_run` or `complete_run`. `get_issue` does not depend on the Run, so continue with it. Tell the user once: "The Harnessforce hook is not running, so the Run cannot be recorded. Run `/harnessforce:setup`".

## What is not recorded

- Harnessforce does not record a Plan, a Decision, or a Definition of Done, and the Harnessforce tools do not create or edit Issues. Issues are GitHub Issues. Harnessforce shows the sessions, Pull Requests, and CI results linked to an Issue without any record from you.
