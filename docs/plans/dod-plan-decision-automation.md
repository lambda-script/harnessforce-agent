# Plan: record Definition of Done, Plan and Decision without relying on people

Delete this file when the last task below is done.

## Premise

Nobody reliably types a Definition of Done (DoD), a Plan or a Decision. Today:

| Record | Who can create it | What happens if nobody does |
| --- | --- | --- |
| DoD item | A person only (`control-plane.md` "Definition of Done") | The DoD stays empty. `complete_run` records nothing, and the `dod` Acceptance kind has no data. |
| DoD fulfilment (met / unmet) | The agent, through `complete_run`, as `proposed` | Nothing, when there are no items. |
| Plan | The agent, through `record_plan`, as `proposed` | Only if the agent follows the `record-run` skill. |
| Decision (Action) | The agent, through `record_decision`, as `proposed` | Same. |

Constraints that stay: agent records stay `proposed` until a person approves; no prompt, response, tool I/O or diff body is sent; the agent does not create Projects, Milestones or Cycles on its own.

## Design

### 1. DoD items: the agent proposes, a person approves

Spec: lambda-script/harnessforce#853 (`docs(spec): let agents propose Definition of Done items and show automatic checks`).

- New MCP tool `propose_definition_of_done_items` (1-10 items, each a `text` of 1-500 characters and a `basis` of `issue_description`, `acceptance_criteria`, `pull_request`, `test` or `check`). Items are summaries of existing text, never copies of a prompt, diff, path, command or secret.
- The `record-run` skill proposes only when the Issue has 0 items and 0 `proposed` items, once per `harnessforce session_id:`, without asking the user (a proposal confirms nothing). A rejected or already-populated DoD gets no further proposals.
- A person approves or rejects in the Issue page "Awaiting approval" band, the same place as Plan proposals. Approval creates the item and a new DoD version, so the existing rule "items are created by people" holds.
- `add_definition_of_done_item` stays for explicit user instructions only.

### 2. Objective facts: derived, not recorded

The "automatic DoD" is a derived "Automatic checks" row on the Issue page (PR state, latest ci / test / lint / typecheck / build / review Evaluations of the confirmed-linked PR). It is not stored, is not a DoD item or version, is not counted in n/m, and does not feed the `dod` Acceptance kind, because the same facts already count as `ci` / `test` / `lint` / `typecheck` / `build` / `review` Evaluations. Recommended over writing `confirmed` records: it keeps "confirmed means a person decided" intact and avoids double counting.

### 3. Plan and Decision: skill-driven, hook-assisted

Server side needs no change (`record_plan` and `record_decision` exist and are `proposed`). The gap is that agents forget. Hooks cannot call MCP tools; they can only add context (`additionalContext`) or print a message. So hooks remind and the agent calls the tool.

- SessionStart (existing): the `using-harnessforce` text names the order: `start_run`, `get_issue`, propose DoD items if empty, `record_plan` if none, `record_decision` at choices, `complete_run`.
- UserPromptSubmit: when the Run was started and no Plan exists after N prompts, add one line to the context. State is a per-session file under the plugin data directory holding only booleans and counters (no prompt text).
- Stop: if a Run is open and `complete_run` was not called, surface a one-line reminder. A blocking Stop is not used: it can loop and is noisy. Whether a non-blocking reminder can be delivered on Stop is a Claude Code / Codex hook-capability question, see "Open facts".
- Codex has fewer hook events (`harnessforce hook session-start` only today); Codex relies on the skill text alone until verified.

## Open facts (not verified in this session)

Tavily (`tvly`) is not installed here, so these were not checked against Claude Code / Codex primary docs and are not asserted: which hook events accept `additionalContext` or `systemMessage`; whether `Stop` can add non-blocking context; the Codex hook coverage. Record the source URL and retrieval date in `docs/references/` when checked (rule: external facts need a primary source).

## Tasks (in dependency order)

1. Harnessforce: approve #853, then Deliver `propose_definition_of_done_items`, the approval procedures, the Issue page band and "Automatic checks" (TDD, changeset).
2. harnessforce-agent: `record-run` and `using-harnessforce` add the DoD proposal step; the MCP tool list in tests and README follows the server's `tools/list`.
3. harnessforce-agent: hook reminders (UserPromptSubmit, Stop) with the booleans-only state file, after the Open facts are verified.
4. Public pages: re-check `apps/web/content` for DoD wording in the Delivery PR of task 1.

## Not in scope

Auto-creating Projects, Milestones or Cycles (product non-goal "AI automatic project planning changes"); auto-confirming any agent record; sending any body text.
