# Plugin evals

Behavior checks for the skills and commands of this plugin, run with
[`claude plugin eval`](https://code.claude.com/docs/en/plugin-evals) (Claude Code v2.1.269 or later).
The build copies only `skills/` and `commands/` into the published plugin, so this directory is never
shipped. `pnpm test` checks the shape of every case without calling a model; running the suite calls
the model on your account, so CI does not run it.

## Layout

- `<skill>/<case>/`: a case that checks one rule of the skill. Its `graders/` compare the run with and
  without the plugin, so each case has to fail without the plugin to stay in the suite.
- `<skill or command>/trigger/<case>/`: a prompt that should, or should not, invoke the skill or command.
  The single grader is a `tool_used: Skill` check.
- `mocks/harnessforce/`: the Harnessforce MCP tools that the skills call. `_tools.json` holds their
  descriptions and input schemas as the product specification defines them
  (`docs/specs/api/mcp.md` of the Harnessforce repository). The `expect:` block of each mock fails the
  run when the skill sends a value the rule forbids, such as a `list_issues` query outside the status
  vocabulary (#112).

The plugin in this directory declares no MCP server and no hook (the build adds them), so a run serves
the mocks as a standalone server named `harnessforce`: the tools are `mcp__harnessforce__<tool>` in both
arms. The documentation does not describe this naming; it was observed with Claude Code 2.1.316, so
check the `mocked:` progress line and the grader results after updating Claude Code. The `harnessforce agent_session_id:` line that the SessionStart hook adds is given with
`append_system_prompt`.

Each case has one tag:

| Tag | Measures | Command |
| --- | --- | --- |
| `trigger` | Whether the skill or command is invoked | `claude plugin eval . --tag trigger --ablation none` |
| `rules` | A rule of a skill, with read-only tools | `claude plugin eval . --tag rules --scaffold` |
| `granted` | A rule that needs Bash, Write and Edit to be measurable. A run has no `harnessforce` CLI, so `harnessforce tune record` always fails | `claude plugin eval . --tag granted --allow-tools Bash Write Edit` |

Run them from `plugins/harnessforce`. `--scaffold` runs the `fixture.sh` of a case, which only creates a git
repository in the run's empty workspace. Add `--model <model>` to pin the model and `--no-publish` to keep
the report local. A suite run costs about cases × runs (3) × arms (2 for `rules` and `granted`) agent
runs; no grader calls a judge model.

## When to run

- A pull request that changes the wording of a skill or a command: run the cases of that skill and its
  trigger cases on `main` and on the branch, and paste both summaries into the pull request.
- A release pull request: run every tag.
- A bug in a skill: add a case that fails on the bug before fixing it, and keep it as a regression.
