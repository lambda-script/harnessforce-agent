---
name: propose-improvements
description: From the analysis results of /harnessforce:tune, make suggested improvements for human interventions, repeatable loops, MCP servers, and usage (context compaction, cache reuse, model choice), record them with harnessforce tune record, and then show them. Use it only for targets that /harnessforce:tune marks as "a suggestion can be made". Does not modify files.
---

# Make improvement suggestions from the analysis results

For each target marked "a suggestion can be made" in the "Targets for suggestions" printed by `summarize.mjs` of `/harnessforce:tune`, make a suggestion. Make each suggestion in a form the user can apply as it is, and record it before showing it.

## Do not modify anything

- Do not modify the user's files, settings, repository, or managed settings. Do not use the Edit or Write tools, `git apply`, `git commit`, creating a branch, or `gh pr create`. The diff and the Pull Request draft are only shown.
- The only thing written is the record that `harnessforce tune record` writes to `~/.harnessforce/tune/`. Do not create temporary files either.

## Conditions for making a suggestion

The result of `summarize.mjs` is authoritative. Make no suggestion for a target marked "Not enough data" or "not measured, so no suggestion is made". The conditions are as follows.

| Target | Minimum condition for a suggestion |
| --- | --- |
| All | The analyzed range has at least 10 sessions |
| Human interventions | That `intervention.kind` appears in at least 3 sessions and at least 10 times in total |
| Repeatable loops | That `loop.kind` appears at least 3 times in total |
| MCP servers | At least 10 sessions have `configured` |
| `frequent_compaction` and `low_cache_reuse` of usage | At least 3 sessions match that `usage.kind` |
| `model_choice` of usage | At least 10 sessions have `models`, and in the total of `models` over the analyzed range, one `message.model` value accounts for at least 90% of the total `output_tokens` |

- Do not use a value that was not measured (`not_measured`) as evidence. Do not treat "not measured" as 0.
- The change type of a usage suggestion is limited to `claude_md`, `rule`, `skill`, `agent`, and `command` (for example, split up a bloated CLAUDE.md, or move exploration to a subagent and specify that agent's `model`). Do not use another change type such as the `model` in settings. `harnessforce tune record` rejects other change types. A change to `claude_md` is not detected when applied, so it does not appear in the before and after of the previous suggestion either.
- Usage values (`usage`) stay on this device and are not sent to Harnessforce. You may use them as evidence for a suggestion.
- Do not make a suggestion about the harness configuration itself (differences in results between skills, rules, agents, commands, hooks, MCP servers, and model versions).
- If you investigate and find no change the user can apply as it is, make no suggestion for that target and say why in one line.

## Gather evidence

- Read only the parts you need of the record at the `transcript_path` of the target's evidence sessions. For human interventions, read the prompts of that kind and the agent response just before them. For loops, read the steps of one cycle (fetching the Issue, fixing, testing, pushing, creating the Pull Request, and so on) and the points where a person intervened. For MCP servers, read the calls and failures. For usage, read the instructions and the course of events before compaction for `frequent_compaction`, the responses before and after where the cache was not reused for `low_cache_reuse`, and the exploration and routine work done by the main agent for `model_choice`.
- When you make a suggestion for the same target as a suggestion that "Before and after the previous suggestion" shows as "Did not move in the improving direction", cite that before and after as evidence and do not repeat the same diff as last time.
- Read the current definition of the target (settings, skill, rule, agent, command, hook, `.mcp.json`, `mcpServers` in `~/.claude.json`, CLAUDE.md) and make the diff against the current content.

## Format

Give each suggestion the following.

| Item | Content |
| --- | --- |
| Target category | One of `intervention.kind=<kind>`, `loop.kind=<kind>`, `mcp_server=<identifier>`, `usage.kind=<kind>`. The `<kind>` of `usage.kind` is one of `frequent_compaction`, `low_cache_reuse`, `model_choice` |
| Evidence | The period, the counts, the times of the matching sessions, and excerpts of the records. Excerpts are shown on this device only |
| Change type | One of `permissions`, `hook`, `skill`, `rule`, `agent`, `command`, `loop_prompt`, `mcp_config`, `claude_md` |
| Apply to | The user scope, the repository scope, or managed settings, and the file path |
| Change | A unified diff that can be applied as it is. For the repository scope, a Pull Request draft made of the branch name, the title, the body, and the diff. For managed settings, the diff that an Owner or Admin pastes |
| Expected effect | Which category value decreases, and which existing metric (CI failure rate, rework rate, cost per completed Issue) changes |
| How to measure | The ComponentVersion that changes when applied (kind and identifier), and the metric used for comparison |

The change type and the component that changes when applied correspond as follows.

| Change type | Component `kind` | Component identifier (`id`) | Expected content |
| --- | --- | --- | --- |
| `permissions` | `permissions` | `permissions` | The whole `permissions` value of the settings after applying (`value`) |
| `hook` | `hook` | The event name of the hook | The value of that event under `hooks` in the settings after applying (`value`) |
| `skill` | `skill` | The directory name of the skill | The whole content of `SKILL.md` after applying (`content`) |
| `rule` | `rule` | `CLAUDE.md` or `rules/<path>` | The whole content of the file after applying (`content`) |
| `agent` | `agent` | The path from `agents/` without `.md`, with `/` replaced by `:` | The whole content of the file after applying (`content`) |
| `command` | `command` | The path from `commands/` without `.md`, with `/` replaced by `:` | The whole content of the file after applying (`content`) |
| `loop_prompt` | `command` or `skill`, following the format of the file written | Same as `command` or `skill` above | The whole content of the file after applying (`content`) |
| `mcp_config` | `mcp_server` (a diff that deletes the server has no component) | The server name | The definition of the server after applying (`value`). For deletion, the whole content of the file after applying (`content`) |
| `claude_md` | None | None | The whole content of CLAUDE.md after applying (`content`) |

The component `source` is the scope it applies to (`user`, `repository`, `local`, `managed`). A server in `.mcp.json` is `repository`, the top-level `mcpServers` of `~/.claude.json` is `user`, and the one under its `projects` is `local`.

## Suggestions to reduce permissions

- A suggestion to reduce answers to permission prompts takes the tools that asked for confirmation and the breakdown of their permissions as evidence. Allow only the smallest range of tools and commands that appeared in the evidence (for example `Bash(pnpm test:*)`, `Bash(git status)`, `mcp__github__get_issue`).
- Do not suggest a rule that allows all commands. Do not include in any suggestion a permission for a whole tool or all commands such as `Bash`, `Bash(*)`, `Bash(:*)`, or `*`, nor `"defaultMode": "bypassPermissions"` or `--dangerously-skip-permissions`.

## Suggestions for loops

- A suggestion for a repeatable loop is a prompt in the form of a command or a skill (`loop_prompt`), and it must include stopping conditions. The stopping conditions are both the maximum number of repetitions and the points where a person checks (for example before creating a Pull Request, or when the same failure happens twice in a row).
- In the prompt, replace each point where a person intervened in the evidence sessions with either a stopping condition or a step the agent does by itself.

## Record, then show

Before showing a suggestion, run `harnessforce tune record` for each suggestion and pass one UTF-8 JSON object on stdin. Pass the input with a heredoc and do not write it to a file. Use a delimiter word that does not appear in the input.

```sh
harnessforce tune record <<'HF_TUNE_RECORD_7f3c'
{"category": "...", "change_type": "...", "scope": "...", "path": "...", "evidence_session_ids": ["..."], "body": "..."}
HF_TUNE_RECORD_7f3c
```

| Item | Required | Content |
| --- | --- | --- |
| `category` | yes | The target category |
| `change_type` | yes | The change type |
| `scope` | yes | One of `user`, `repository`, `local`, `managed` |
| `path` | yes | The absolute path of the file the change writes |
| `project_root` | required when `scope` is `repository` or `local` | The absolute path of the root of the repository it applies to. Do not pass it otherwise |
| `component` | required for a change that has a component in the table above | `kind`, `source`, `id` |
| `content` | required when the `kind` of `component` is `rule`, `skill`, `agent`, or `command`, and when there is no component | The whole content of the file at `path` after applying |
| `value` | required when the `kind` of `component` is `hook`, `permissions`, or `mcp_server` | The settings value (JSON) of that component after applying |
| `evidence_session_ids` | yes | The session IDs of the evidence sessions (at least 1). Use only those shown in the evidence sessions |
| `body` | yes | The body of the suggestion (markdown): the evidence, the change, the expected effect, and how to measure |

- Show only the suggestions for which `harnessforce tune record` ended with exit code 0. Do not show a suggestion that ended with a non-zero code, and tell the user the message on stderr.
- Record the same suggestion with the same input. With the same `category`, `change_type`, `path`, and content after applying, it counts as one no matter how many times it is recorded.
- When showing, present the target category, the evidence, the change type, where to apply, the change, the expected effect, and how to measure, in this order.
