# Self-improvement for harnessforce-agent

Status: implementation plan. Delete this file when the last PR in [Delivery sequence](#delivery-sequence)
is merged (`docs/plans/` holds unfinished plans only).

Canonical behavior lives in the Harnessforce specs (`lambda-script/harnessforce`,
`docs/specs/features/improvement-loop.md`, `correlation.md`, `api/mcp.md`, `features/operations.md`).
This plan adds nothing to them; where a step needs a spec change it is listed under
[Spec changes that need approval](#spec-changes-that-need-approval) and is not started.

## Request

Give harnessforce-agent the same self-improvement capability as `lambda-harness` and
`anthropics/skills` (skill-creator): Issues, PRs, Runs and Actions are created, monitored and measured
through the `harnessforce` CLI or MCP with as little manual work as possible.

## Findings that shape the design

1. **Server-side monitoring and measurement already exist.** Run→PR→Issue links are derived from
   branch names, PR text and transitivity (`correlation.md` "経路"); CI and review become Evaluations;
   Monitors, Baseline comparison and the before/after view (`operations.md`) measure outcomes. The gaps
   are on the agent side: what gets *created*, and what triggers the *loop*.
2. **The product loop is already specified and deliberately not automatic.** `improvement-loop.md`
   defines observe (`harnessforce tune`) → propose (`propose-improvements`) → apply by the user →
   measure (before/after of applied proposals). Auto-applying, opening PRs in the user's repository,
   server-side scheduling and harness-config proposals are listed non-goals with numeric reopening
   conditions, and "Harnessforce holds no write permission to the user's environment" is the premise of
   security review. A design that makes the *product* open PRs would contradict that.
3. **Our own assets can be fully automated.** `plugins/harnessforce/skills/*`, commands and hooks are
   code in this repository. Maintainers' use of them can follow the lambda-harness loop (eval →
   change → PR → human merge) without touching any user environment.
4. **The current agent-side creation path depends on the agent obeying a skill.** `record-run` is the
   only path to Plan, Action (`record_decision`) and Definition of Done; it is narrower than the spec
   (harnessforce#763). Hooks only register sessions and count usage (`plugins/harnessforce/build.mjs`).
   The hooks documentation does not name `ExitPlanMode` or `AskUserQuestion` (checked 2026-10-14,
   https://code.claude.com/docs/en/hooks, first 100,000 characters), so approval/answer events cannot be
   a basis for automatic Actions yet. harnessforce PR #796 (Action from merged/closed PRs, server-side)
   was closed on 2026-10-13 without merge.

## Two loops

| | Loop A: product (end users) | Loop B: asset (maintainers of this repo) |
| --- | --- | --- |
| Subject | The user's own harness (skills, rules, hooks, MCP config) | `record-run`, `propose-improvements`, `using-harnessforce`, commands, hooks, CLI |
| Authority | Spec-fixed: the user applies; Harnessforce never writes | Ours: agents open PRs, humans merge |
| Status | Specified; v1 delivered by `tune` | Missing; this plan |

## Gap table (current → target)

"Auto" means no per-occurrence human or agent decision is needed.

| Item | Create | Monitor | Measure |
| --- | --- | --- | --- |
| Run | **Auto**: SessionStart hook registers; `harnessforce run --issue` links at 1.0. **Manual**: `harnessforce import` (once, from `/harnessforce:setup`); `start_run` only if the agent follows `record-run` | **Auto** server-side (ingestion health, Monitors). Agent side: `harnessforce top` is local and pull-only | **Auto**: OTel cost, time, tokens; usage summary. Analysis report only when the user runs `tune` |
| Plan | Agent-voluntary `record_plan` (`proposed`) | Server shows `proposed` until a human approves | `plan_before_handoff` practice metric (server) |
| Action (decision) | Agent-voluntary `record_decision`; skill condition narrower than spec (#763); no hook path | Server | Action counts exist; auto-recorded facts not implemented (#796 closed) |
| Definition of Done | Agent-voluntary in `complete_run` | Server | Server |
| Issue | `create_issue` after in-session consent; impossible in non-interactive runs by design | Provider sync (server) | Correlation rate (server) |
| PR | Agent or human with `gh`; Harnessforce does not create PRs | **Auto** server-side: link from branch/PR text, review and CI Evaluations | **Auto**: first-pass CI/review, time to merge, rework |
| Improvement proposal | Agent writes after `/harnessforce:tune`; user applies | Applied-detection at next `tune` | Before/after (14 days, ≥5 sessions) on the device; server comparison is Team-improvements stage |
| Our own assets | Hand-edited | None | None |

Conclusion: PR monitoring/measurement and Run creation are largely automatic. The manual or
unreliable parts are (a) agent-voluntary Plan/Action recording, (b) `tune` only when someone remembers,
(c) no regression check for any plugin asset, (d) no loop at all for our own assets.

## Loop design

Each stage lists who acts, what is recorded, and where. Content (prompts, responses, tool I/O, diffs)
is never collected beyond what the specs allow (data minimization).

| Stage | Loop A (spec-fixed) | Loop B (this plan) |
| --- | --- | --- |
| Observe | `harnessforce tune` counts interventions, loops, MCP use, usage by public rules → `~/.harnessforce/tune/` | The maintainers' own Runs in a dogfood Workspace: correlation rate, Actions per Run, `permission_prompts_per_run`, `ci_first_pass`, via `aggregate_runs`/`list_actions` MCP reads; plus a friction note in the PR when an asset misled an agent |
| Reflect | Summary from `summarize.mjs` (counts only) | `scripts/self-improve-report.mjs` (maintainer-run, cron-able): one weekly summary of the metrics above, `not_measured` kept distinct from 0 |
| Propose | `propose-improvements` → `tune record` | The report opens or updates one GitHub issue in this repository (marker line for de-duplication) listing assets whose metric moved the wrong way; the fix is a PR |
| Verify | None: sessions cannot be replayed. The user's check is the before/after | **Eval**: `evals/<asset>.json` binary assertions, run with the old and new asset against a stub MCP server; assertions are over the recorded tool-call trace, not an LLM judge |
| Apply | User | PR via `pr-follow-through`; **a human merges** |
| Measure | Before/after of applied proposals | The next weekly report; the PR links the issue it answers |

### Eval harness (Loop B)

Follows lambda-harness `skill-creator`: binary pass/fail assertions, at least 3 realistic scenarios per
asset, a baseline run without the change.

- `evals/record-run.json`: `{id, prompt, context, assertions[]}`. Assertions are predicates over the
  stub's recorded calls, e.g. "`start_run` is not called when the context has no `harnessforce
  session_id:` line", "after the user answers a question, `record_decision` is called without asking",
  "`decision` does not contain the user's text".
- A stub MCP server in `packages/test-support` implements the five tool names and logs calls.
- `scripts/run-evals.mjs` runs each scenario through `claude -p` with `--plugin-dir` pointing at the
  working tree (candidate) and at `git show origin/main:` output (baseline), then prints pass counts
  for both. It is local-only and heavy: run through the `/tmp/hf-heavy` semaphore, one at a time.
- CI runs only the static part: every skill has an eval file with ≥3 scenarios, ids are unique,
  assertions reference known predicates, and `evals/` is absent from the npm package (the plugin
  package must not ship it).

### Triggers

| Trigger | What runs | Needs consent |
| --- | --- | --- |
| Editing a plugin skill/command/hook (Loop B) | CI static eval check; maintainer runs `run-evals.mjs` before review | No |
| Weekly (Loop B) | `self-improve-report.mjs` from a maintainer's scheduler | No (our repository, our Workspace) |
| `/harnessforce:tune` (Loop A) | As specified | As specified |
| Scheduled `tune` for users (Loop A) | `harnessforce tune --report-only` registered by the user's own scheduler | Yes: see gate G2 |

## Delivery sequence

Order is by dependency. Every PR is independently complete (spec, tests, code, docs together) and
uses `feature/…`, `bugfix/…` or `chore/…` branches.

| # | PR | Depends on | Gate | Acceptance (observable) |
| --- | --- | --- | --- | --- |
| 1 | `fix(plugin): make record-run and using-harnessforce record user decisions as Actions` (closes lambda-script/harnessforce#763) | none | none (implementation catches up to the existing spec) | The `record-run` text contains the spec's condition (user decision, plan approval/rejection, scope decisions → `record_decision` without asking; own words, no quotation of the user); `using-harnessforce` states the same; a test in `plugins/harnessforce/test` fails on the old text |
| 2 | `chore(plugin): add the eval harness for plugin skills` | 1 | none | `pnpm check` passes; `evals/record-run.json` has ≥3 scenarios incl. the three examples above; CI fails when a skill has no eval file; the packed plugin contains no `evals/`; `node scripts/run-evals.mjs --skill record-run` prints baseline vs candidate pass counts |
| 3 | `test(plugin): fail when plugin README, skills and commands drift apart` | 2 | none | A test compares the README "What it contains" table with `skills/` and `commands/`; adding a skill without a table row, or a skill description without a trigger clause, fails `pnpm test` |
| 4 | `chore: add scripts/self-improve-report to open one weekly improvement issue` | 2 | none (our repo, our Workspace) | Running it twice in a week updates the same issue (marker line); metrics with no data say "not measured", never 0; it sends nothing to Harnessforce and uses read-only MCP/Read API calls |
| 5 | `feature(cli): offer a user-registered schedule for tune` | spec S2 approved | G2 | `/harnessforce:setup` offers it unchecked by default with consent text; `--print-schedule` prints the cron/launchd line and registers nothing; `--report-only` sends the analysis report and makes no proposal |

PR 1–3 are the minimum useful set and need no approval. PR 4 can start after 2. PR 5 waits for G2.
Auto-recording of Actions from GitHub facts (#796) is server-side and needs no agent PR; hook-based
Actions (plan approval, answers) are not planned until G3 is met.

## Spec changes that need approval

None of these is started. Each changes behavior the user sees or widens collection.

| Id | Change | Recommendation | Reason |
| --- | --- | --- | --- |
| S1 | Revive #796: Action `origin=auto` from merged/closed PRs with a confirmed link | Approve, with the `recorded_by:auto` filter | Based on confirmed GitHub facts only; no content; fixes "Action depends on the agent remembering". Adds rows to Actions lists, so the user decides |
| S2 | Move `tune --report-only` and `--print-schedule` from Team improvements to v1, opt-in only | Approve | Without it the loop never runs unattended. Harnessforce still registers nothing; the user's own scheduler runs it. Uses the same opt-in pattern as `usage-limits` |
| S3 | Hook-derived decision facts (plan approved/rejected, option chosen) | Do not start | The hooks documentation does not describe the inputs (G3); needs a dated reference in `docs/references/` first |

## Gates (decisions owned by the user)

| Gate | Question | Recommendation |
| --- | --- | --- |
| G1 | Is Loop B's weekly issue/PR automation acceptable in this repository (agents open issues and PRs, humans merge)? | Yes. It is our repository and follows the existing merge rule |
| G2 | Does the user accept S2 (scheduled `tune` as an opt-in)? | Yes, opt-in with consent text |
| G3 | Wait for a primary source on `ExitPlanMode`/`AskUserQuestion` hook input before any hook-derived Action? | Yes |
| G4 | Keep the product non-goals (auto-apply, PRs in user repositories, harness-config proposals) as they are? | Yes. Reopen on the numeric conditions in `improvement-loop.md` |

## Not in this plan

- Replaying a user's sessions to evaluate a proposal: the transcripts are not collected and cannot be
  replayed; the before/after view is the measurement.
- Changing the data collected or sent. Everything here uses existing fields.
- Public pages live in `lambda-script/harnessforce` (`apps/web/content/`), not here. This plan changes
  no user-visible behavior; each spec change above checks the public pages in its own PR.
