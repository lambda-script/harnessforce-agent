# CI/CD pipeline diagrams

Which jobs run on which trigger, in what order, under which conditions, and where they deploy. Draw it as `flowchart LR`, one diagram per workflow or per trigger.

## Sources and what to take from them

| Source | Take |
| --- | --- |
| `.github/workflows/*.yml` | `on` (triggers, branches, paths, labels), `jobs.<id>.needs` (order), `if` (conditions), `strategy.matrix` (fan-out), `environment` (deploy targets and approvals), reusable workflows (`uses:`) |
| `lefthook.yml`, `.husky/`, `pre-commit` config | local hooks that run before CI |
| `turbo.json`, `nx.json` | task dependencies (`dependsOn`) when the jobs only call these tasks |
| Deploy docs | promotion between environments, manual steps |

Read `${{ secrets.* }}` and `vars.*` names only to know that a secret exists; never draw their values. Avoid drawing secret names at all unless the question is about credentials.

## Shape of the diagram

Two diagrams usually answer the questions people ask: the checks on a pull request (`ci.mmd`), and how a merged change reaches production (`deploy-pipeline.mmd`).

- Trigger on the left (a node per trigger: `push main`, `pull_request`, `label ci:full`, `schedule`, `workflow_dispatch`), then jobs by `needs`, the gate and the merge on the right. A local check that merging depends on (heavy suites a person runs by hand on dangerous changes and reports in the pull request body) goes left of the triggers with a dashed edge into `pull_request`, and its role says who checks it; local hooks that only lint belong to a diagram of the local checks.
- Every job is a logo tile like an architecture node: the tool it runs when it has a logo (Vitest, Storybook, Playwright, Next.js, TypeScript for lint and types), otherwise a Lucide icon for what it does (`lucide/file-diff` for path filters, `lucide/list-checks` for lint, `lucide/shield-check` for the gate). Plain rectangle nodes render their text much smaller than tile labels.
- A matrix job is one node; put the axis in the role (`integration ×2, workers`).
- Group jobs that run under the same condition (`Light suites: every push`, `Heavy suites: ci:full or manual`) and draw `needs` to and from the group (`light --> result`, `light -->|if a heavy suite is picked| build`). One edge per job turns a fan-in like `needs: [changes, lint, unit, storybook, build-web, backend, system]` into a knot.
- Put the CI system's mark on each job group's title (`<img src='icon:actions' …/> <b>Light suites</b>`) and the forge's mark on the triggers group (GitHub), as for vendor groups (mermaid-layout.md rules 44 and 50).
- End the gate in outcome groups: the merge in a green `Pass` group, what a failure opens (an issue that stops merges) in a red `Fail` group (mermaid-layout.md rule 51).
- Put a short `if` on the edge label (`if a heavy suite is picked`), not the whole expression. Long conditions go in a `%%` comment with the file and line.
- The primary flow (blue) is the path every pull request takes: trigger → path filter → light suites → gate → merge. Paths taken only on a label or a manual run are secondary (gray); ways the gate fails or blocks merges are red and dashed.
- For promotion and deploy, draw each promotion pull request as a node and the merge as the edge label (`merge`). Draw the deploy job as a group of its steps in order, each step with the logo of the platform it changes (Neon for the migration, Cloudflare Workers, Vercel, the AWS Systems Manager icon for reading secrets from SSM), instead of separate target nodes, and nest the steps in one group per platform with its mark (mermaid-layout.md rules 50 and 53). When a person must check something before merging, put it on the merge edge.
- Group jobs by workflow file when one diagram shows several workflows.

## Pitfalls

- `needs` gives order, not conditions: a job with `if: always()` runs after a failed dependency. Say so on the edge.
- Jobs skipped by path filters still appear in the graph; show the filter on the trigger edge.
- A job that runs in several environments (`environment: ${{ ... }}`) or modes (`workflow_dispatch` inputs) is drawn once; name the modes on the trigger and list what each skips in the review, not as parallel paths.
