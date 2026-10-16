# @harnessforce/claude-code-plugin

## 0.2.0

### Minor Changes

- a037024: Make all user-facing text English only: the CLI output, the hook warnings, the loopback page, and the plugin commands, skills, and docs. The consent text of `harnessforce usage-limits on` no longer switches to Japanese by locale.
- f68d5b9: Add the `/harnessforce:status`, `/harnessforce:import`, `/harnessforce:usage-limits`, `/harnessforce:run` and `/harnessforce:help` commands, which wrap the `harnessforce` CLI inside a Claude Code session. `/harnessforce:status` summarizes `harnessforce top --once --json`; `/harnessforce:usage-limits` only shows the state and leaves turning sharing on or off to you.

### Patch Changes

- b21372c: Make the `record-run` and `using-harnessforce` skills add Definition of Done items with `record_definition_of_done_items` when the Issue has none, so a person only has to review them.
- c3a4521: Rename the MCP tool `record_decision` to `record_action` in the `record-run` and `using-harnessforce` skills, so the agent calls the tool under the name the Harnessforce server now exposes.
- bb5873b: Make the `record-run` skill record the user's decisions (choosing an option, approving or rejecting a plan, setting scope) as Actions without asking.
- 337b7e6: `/harnessforce:setup` now relays the reasons and the next step that `harnessforce import` prints when it imports nothing.
