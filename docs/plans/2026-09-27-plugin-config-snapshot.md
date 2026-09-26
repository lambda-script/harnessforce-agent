# Plugin config snapshot

**Goal**: The SessionStart hook collects the agent configuration (hashes only) and sends one config snapshot to `POST <HARNESSFORCE_ENDPOINT>/v1/config-snapshots`, next to the session registration. Fail-open like PR #2.

**Canonical spec** (lambda-script/harnessforce#22, branch `spec/agent-session-registration`):

- `docs/specs/features/correlation.md`: hook (SessionStart, 共通の規則), 構成のバージョン, 構成の収集, 受入条件
- `docs/specs/api/semantic-conventions.md`: Config snapshot (ID normalization)
- `docs/specs/api/ingest-api.md`: `/v1/config-snapshots`
- `docs/references/claude-code.md`: settings scopes, file locations, plugins root

**Branch**: `feature/plugin-config-snapshot`, base `feature/plugin-session-registration` (PR #2).

**Architecture**: The collector lives in `packages/cli/src/config/` so `hf run` (a later Delivery) computes the same snapshot ID. The plugin bundles it from source, like semconv. It uses only Node 18 APIs (the bundle target). The collector reads the real filesystem; tests build fixture trees in temp directories. The hook receives `homeDir` and `managedDir` as dependencies so tests never touch system paths.

## Tasks (TDD: RED, then GREEN, one commit each)

1. **Canonical JSON and hashes** (`packages/cli/src/config/canonical.ts`): canonical JSON (keys in UTF-16 code unit order, no whitespace), SHA-256 of file bytes with CRLF→LF, component ordering, snapshot ID.
2. **File-based kinds** (`collect.ts`): rule, skill, agent, command, workflow for managed/user/repository/local; recursion, hidden entries, depth 8, identifier token check.
3. **Settings-based kinds**: hook, permissions, model from the four settings sources (managed file plus `managed-settings.d` merge); mcp_server from `managed-mcp.json`/`managedMcpServers`, `.mcp.json`, `~/.claude.json` (only without `CLAUDE_CONFIG_DIR`).
4. **Plugin components**: `enabledPlugins` merge, `installed_plugins.json` lookup, `<name>:` prefix, version.
5. **Limits**: 1 second deadline and 1,000 components → skipped with reason.
6. **Hook**: SessionStart sends registration and snapshot in parallel; snapshot also outside git; `resume`/`compact` send neither; one `systemMessage` on 401; `config snapshot failed/skipped` stderr; project root via `git rev-parse --show-toplevel`.
7. **Bundle, build inputs, README**: built marketplace sends a snapshot for a real temp config tree; turbo inputs include `packages/cli/src/config/**`.
8. **Final**: `pnpm check`, reviews, delete this plan.
