---
name: record-run
description: For work on a Harnessforce Issue (an identifier such as ENG-42), use the tools of the Harnessforce MCP server to register this session as a Run and record the Plan, the Decision, and whether the Definition of Done is met. Use it when you start work on an Issue, when you start work that commits changes without an Issue being specified, when you change course, and when you finish the work.
---

# Record work on a Harnessforce Issue

Use the tools of the Harnessforce MCP server to link the work to the Issue and record it. The first time you use a tool, you are asked to log in in the browser and choose a Workspace.

## At the start of the work

If the user has not given an Issue, follow "When no Issue is specified" below first.

1. Pass the value of `harnessforce session_id: <session_id>` in the context as `session_id`, and register the Run with `start_run`. The Harnessforce plugin adds this line to the context at session start. If there are several, use the last one added. The input is the Issue identifier (`issue_identifier`), `agent` (`claude_code`), and `session_id`. If you know the repository, branch, and commit you are working on, pass them too. Keep the returned `run_id` until the end. If the line is missing from the context, follow "When the session ID is missing" below.
2. Check the Issue, the Plan, and the Definition of Done with `get_issue`. For a native Issue, follow "Status of a native Issue" below. A Plan is distinguished by its status (current or `proposed`).
3. If there is neither a current Plan nor a `proposed` Plan, record the approach to the work with `record_plan`. Write the body in markdown.

## During the work

- When you change course or choose from several options, record it with `record_decision`. Always write the title (`title`), what you decided (`decision`), and the reason (`rationale`), and write the options you considered in `alternatives`.

## When the session ID changes

- If the value of the last `harnessforce session_id:` in the context differs from the value you passed to the previous `start_run` (for example after forking the conversation or running `/clear`), call `start_run` once more with the new value before continuing, and use the returned `run_id` for later `complete_run` calls.

## At the end of the work

- Pass `complete_run` the `run_id` and, for each Definition of Done item returned by `get_issue`, whether it is met (`item_id`, and `met` if satisfied or `unmet` if not). If there are no Definition of Done items, pass no items.

## When no Issue is specified

If the user starts work without giving an Issue, ask whether to create one. Create an Issue only after the user agrees.

1. Ask only when all of the following hold.
   - The user has not given an Issue identifier. If the current branch name contains an identifier such as `ENG-42`, `eng-42-login`, or `gh-45-fix` and `get_issue` can resolve that Issue (pass `gh-<number>` as `<owner>/<repo>#<number>` of that repository), treat it as the Issue the user gave, go to "At the start of the work", and do not ask. If it is `not_found`, treat it the same as when there is no identifier.
   - The work commits changes. Do not ask for research, answers to questions, or conversations that only plan.
   - The context has a `harnessforce session_id:` line.
   - Ask only once for the same value of the last `harnessforce session_id:` in the context. If the user declines, do not ask again while the value stays the same. If the value changes through a fork or `/clear`, you may ask again.
2. Show existing Issues first. From the summary of the work, pick up to 3 words likely to appear in an Issue title, and call `list_issues` once per word with `q` set to `-status:done,canceled {word}` and `sort` set to `updated`. Free text with several words matches only Issues that contain all of them, so call it per word. Merge the results, remove duplicates, and show up to 5 candidates, most recently updated first. If the user picks a candidate, do not create an Issue and go to "At the start of the work" with that Issue.
3. If no candidate fits, show a proposal to create one.
   - title: a summary of the work, at most 80 characters.
   - description: a bulleted list of the goal and the completion conditions.
   - Project: call `list_projects` with `q` set to `status:active`; use the single result, or let the user choose if there are 2 or more. If there are 0, do not create the Issue and say so.
   - Do not copy the prompt text, file paths, commands, or secrets into the title or the description. The title appears in lists and URLs and is read more widely than the description.
   - For a team that uses an external issue tracker, say "Created in Harnessforce only", and that it is not written back to the external tool.
4. Only if the user accepts the proposal, create the Issue with `create_issue` and call `start_run` from "At the start of the work" with the returned identifier. If the user edits the proposal, create it with the edited values. Acceptance is an explicit reply from the user in the conversation. In a non-interactive run or an automated run with no user, no reply can be obtained, so do not create it.
5. When it cannot be created and when it fails:
   - If `create_issue`, or `start_run` after the user picked a candidate, returns `forbidden` (including a Viewer token and `workspace_read_only` of a view-only Workspace), tell the user the reason it cannot be created as it is, and do not ask again for the same session ID.
   - Do not retry `create_issue`. Retrying can create two Issues. If the result is unknown, for example after a timeout, search the title of the proposal as free text with `list_issues`; if an Issue whose title matches exactly and whose creation time is after the call is found, use it. If none is found, tell the user it could not be created.
   - If `create_issue` succeeds and only `start_run` fails, tell the user the identifier of the created Issue and do not recreate the Issue.
6. Do not call `create_project`, `create_milestone`, `create_cycle`, or `create_objective` on your own judgment. Do not change the target date, the parent, the Priority, or the Assignee on your own either. These are changes to the plan, and you call them as instructed only when the user explicitly instructs it in the conversation.

## Status of a native Issue

- For a native Issue (an Issue whose `external` in `get_issue` is `null`) whose status when you start work is `backlog` or `unstarted`, ask "Set the status to 'In progress'?" after `start_run`, and only if the user agrees change the status to `started` with `update_issue`. Pass `update_issue` the `version` of the Issue returned by `get_issue` (not `definition_of_done.version`) together with the current values of the other attributes that stay unchanged.
- At the end of the work, if the user indicates the task is complete, ask "Set the status to 'Done'?" after `complete_run`, and only if the user agrees change the status to `done`. Do not ask when you only opened a Pull Request and it has not been merged.
- Do not change the status of an externally sourced Issue. The external tool is the source of truth for the status. For a GitHub Issues Issue, you may suggest `Closes #<number>` as text for the user to put in the Pull Request body. Do not use it as a substitute for linking the Pull Request and the Issue yourself.
- If `update_issue` returns `conflict`, reread with `get_issue`, tell the user, and ask once more. If it returns `conflict` again, say so and finish.

## When the session ID is missing

- If the context has no `harnessforce session_id:` line, do not guess and pass a session ID, and do not call `start_run` or `complete_run`. `get_issue`, `record_plan`, and `record_decision` do not depend on the Run, so continue with them. Tell the user once: "The Harnessforce hook is not running, so the Run cannot be recorded. Run `/harnessforce:setup`".

## How records are treated

- The Plan, the Decision, and the Definition of Done status recorded by the agent are stored as `proposed` and are not final until a person approves them. Do not tell the user that what you recorded is final.
