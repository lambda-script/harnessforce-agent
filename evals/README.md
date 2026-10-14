# Plugin evals

Binary regression checks for the skills in `plugins/harnessforce/skills/`. Maintainer-only: this directory is
outside the plugin and is never shipped.

- `<skill>.json` holds at least 3 scenarios: `{id, prompt, context, assertions[]}`.
- Assertions are predicates over the tool calls the agent made to the stub MCP server
  (`scripts/stub-mcp.mjs`): `called`, `not_called`, `called_before`, `arg_excludes`, `arg_equals`.
  There is no LLM judge, so a result does not depend on wording.
- `pnpm test` checks statically that every skill has a valid eval file.
- `node scripts/run-evals.mjs --skill record-run [--baseline-ref origin/main]` runs each scenario with
  `claude -p` against the working tree (candidate) and the ref (baseline) and prints both pass counts.
  It is slow and uses the model: run it by hand, through the `/tmp/hf-heavy` semaphore, one at a time.
