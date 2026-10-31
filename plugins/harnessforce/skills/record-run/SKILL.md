---
name: record-run
description: For work on a Harnessforce Issue (an identifier such as ENG-42), use the tools of the Harnessforce MCP server to register this session as a Run and to close the Run when the work ends. Use it when you start work on an Issue and when you finish the work.
---

# Record work on a Harnessforce Issue

Use the tools of the Harnessforce MCP server to link the work to the Issue. The first time you use a tool, you are asked to log in in the browser and choose a Workspace.

## At the start of the work

1. Pass the value of `harnessforce session_id: <session_id>` in the context as `session_id`, and register the Run with `start_run`. The Harnessforce plugin adds this line to the context at session start. If there are several, use the last one added. The input is the Issue identifier (`issue_identifier`), `agent` (`claude_code`), and `session_id`. Do not pass the repository, branch, or commit: the hook registers the same session and fills them in. Keep the returned `run_id` until the end. If the line is missing from the context, follow "When the session ID is missing" below.
2. Check the Issue with `get_issue`.

## When the session ID changes

- If the value of the last `harnessforce session_id:` in the context differs from the value you passed to the previous `start_run` (for example after forking the conversation or running `/clear`), call `start_run` once more with the new value before continuing, and use the returned `run_id` for later `complete_run` calls.

## When no Issue is specified

Ask the user once whether to link the work to an existing Issue, only when all of the following hold. Do not create an Issue: Issues are GitHub Issues.

- The user has not given an Issue identifier. If the current branch name contains an identifier (a branch name `gh-<number>` is passed as `<owner>/<repo>#<number>` of the repository) and `get_issue` resolves it, treat it as the specified Issue and do not ask. If `get_issue` returns `not_found`, treat it as no identifier.
- The work commits changes. Do not ask for research, answering questions, or conversations that only plan.
- The context has a `harnessforce session_id:` line.
- You have not asked yet for the last `harnessforce session_id:` value in the context. If the user declines, do not ask again while the value stays the same. After a fork or `/clear` changes the value, you may ask again.

To show the candidates, pick up to 3 words from the summary of the work that are likely to appear in an Issue title, and call `list_issues` once per word with `q` set to `-status:done,canceled <word>` and `sort` set to `updated`. Merge the results, remove duplicates, and show at most 5 Issues, most recently updated first. If the user picks one, call `start_run` with that Issue. If there is no candidate or the user picks none, continue the work without calling `start_run`.

If `start_run` returns `forbidden` (a view-only token or a view-only Workspace), tell the user the reason as it is, and do not ask again for that session ID.

## At the end of the work

- Call `complete_run` with the `run_id`.

## When the session ID is missing

- If the context has no `harnessforce session_id:` line, do not guess and pass a session ID, and do not call `start_run` or `complete_run`. `get_issue` does not depend on the Run, so continue with it. Tell the user once: "The Harnessforce hook is not running, so the Run cannot be recorded. Run `/harnessforce:setup`".

## What is not recorded

- Harnessforce does not record a Plan, a Decision, or a Definition of Done, and the Harnessforce tools do not create or edit Issues. Issues are GitHub Issues. Harnessforce shows the sessions, Pull Requests, and CI results linked to an Issue without any record from you.
