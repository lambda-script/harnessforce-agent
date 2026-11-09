---
name: record-session
description: For work on a Harnessforce Issue (an identifier such as ENG-42), use the tools of the Harnessforce MCP server to register this session as a Session and to close the Session when the work ends. Use it when you start work on an Issue and when you finish the work.
---

# Record work on a Harnessforce Issue

Use the tools of the Harnessforce MCP server to link the work to the Issue. The first time you use a tool, you are asked to log in in the browser and choose a Workspace and a Project.

## At the start of the work

1. Pass the value of `harnessforce agent_session_id: <agent_session_id>` in the context as `agent_session_id`, and register the Session with `start_session`. The Harnessforce plugin adds this line to the context at session start. If there are several, use the last one added. The input is the Issue identifier (`issue_identifier`), `agent` (`claude_code`), and `agent_session_id`. Do not pass the repository, branch, or commit: the hook registers the same session and fills them in. Keep the returned `session_id` until the end. If the line is missing from the context, follow "When the session ID is missing" below.
2. Check the Issue with `get_issue`.

If the user names the Issue in the middle of a session, the work on it starts then: do both steps at that point. The Session links to the whole agent session, so the earlier work is included.

## When the session ID changes

- If the value of the last `harnessforce agent_session_id:` in the context differs from the value you passed to the previous `start_session` (for example after forking the conversation or running `/clear`), call `start_session` once more with the new value before continuing, and use the returned `session_id` for later `complete_session` calls.

## When no Issue is specified

Ask the user once whether to link the work to an existing Issue, only when all of the following hold. Do not create an Issue: Issues are GitHub Issues.

- The user has not given an Issue identifier. If the current branch name contains an identifier (a branch name `gh-<number>` is passed as `<owner>/<repo>#<number>` of the repository) and `get_issue` resolves it, treat it as the specified Issue and do not ask. If `get_issue` returns `not_found`, treat it as no identifier.
- The work commits changes. Do not ask for research, answering questions, or conversations that only plan.
- The context has a `harnessforce agent_session_id:` line.
- You have not asked yet for the last `harnessforce agent_session_id:` value in the context. If the user declines, do not ask again while the value stays the same. After a fork or `/clear` changes the value, you may ask again.

To show the candidates, pick up to 3 words from the summary of the work that are likely to appear in an Issue title, and call `list_issues` once per word with `q` set to `-status:resolved,not_planned <word>` and `sort` set to `updated`. Merge the results, remove duplicates, and show at most 5 Issues, most recently updated first. If the user picks one, call `start_session` with that Issue. If there is no candidate or the user picks none, continue the work without calling `start_session`.

If `start_session` returns `forbidden` or `conflict` for the Issue the user picked, follow "When the Session cannot be linked" below, and do not ask again for that session ID.

## At the end of the work

- Call `complete_session` with the `session_id`.

## When the Session cannot be linked

- If `start_session` returns `forbidden` (a view-only token or a view-only Workspace) or `conflict` (this session belongs to another user), tell the user the reason as it is and continue the work. For that session ID, even if the user names another Issue later, do not call `start_session` again, do not call `complete_session`, and do not guess another session ID (a new value in the context after a fork or `/clear` is not a guess). `conflict` is decided by who sent this session and who owns the Session, `forbidden` lasts until the role or the billing changes, and you cannot resolve either; a guessed ID links another session. `get_issue` does not depend on the Session, so continue with it.
- If `complete_session` returns `forbidden` or `conflict`, tell the user the reason as it is, and do not call it again.

## When the session ID is missing

- If the context has no `harnessforce agent_session_id:` line, do not guess and pass a session ID, and do not call `start_session` or `complete_session`. `get_issue` does not depend on the Session, so continue with it. Tell the user once: "The Harnessforce hook is not running, so the Session cannot be recorded. Run `/harnessforce:setup`".

## What is not recorded

- Harnessforce does not record a Plan, a Decision, or a Definition of Done, and the Harnessforce tools do not create or edit Issues. Issues are GitHub Issues. Harnessforce shows the sessions, Pull Requests, and CI results linked to an Issue without any record from you.
