# harnessforce plugin for Claude Code

The `harnessforce` Claude Code plugin links your Claude Code sessions to
[Harnessforce](https://github.com/lambda-script/harnessforce-agent) Issues. It is distributed through
the `harnessforce-agent` marketplace in this repository, not through npm.

## What it contains

| Part | Purpose |
| --- | --- |
| `SessionStart` and `UserPromptSubmit` hooks | Register each session and its config snapshot with Harnessforce |
| MCP server `harnessforce` (`<connection URL>/mcp`, HTTP) | Tools to start a run, read an Issue, and record plans, decisions and the Definition of Done |
| Skill `using-harnessforce` | What Harnessforce records and does not collect, which hook sends what, and when to use the other skills. The `SessionStart` hook injects its body into the context of every session (the build embeds the same text into the hook and the CLI) |
| Skill `record-run` | Tells the agent when to call those tools |
| Command `/harnessforce:setup` | Checks Node.js, installs the `harnessforce` CLI, asks whether to send content, runs `harnessforce init` (`--send-content` when chosen) and `harnessforce import`, offers (unchecked by default) to share your usage limits with `harnessforce usage-limits on --yes`, and confirms the first event after a restart |
| Command `/harnessforce:tune` | Tells you that the agent reads parts of your transcripts through your model provider, runs `harnessforce tune --json`, shows the analysis and the before and after of earlier applied proposals, and makes proposals for the targets with enough data |
| Skill `propose-improvements` | How the agent writes a proposal (evidence, diff or pull request draft, expected effect, how to measure), keeps permissions minimal and loops bounded, and records it with `harnessforce tune record` before showing it |

The hooks and the MCP server exist only in the build output, because their scripts and connection URL
come from the build. The copy of the plugin in this repository has no hooks and no MCP server. See
[Building the local marketplace](../../docs/runbooks/local-marketplace.md).

## Install

Public distribution starts once the production domain of Harnessforce is decided. After that:

```text
/plugin marketplace add lambda-script/harnessforce-agent
/plugin install harnessforce@harnessforce-agent
/harnessforce:setup
```

Until then, install the [local marketplace build](../../docs/runbooks/local-marketplace.md).

## Requirements

Node.js 18 or later on `PATH`. Without it, Claude Code shows a non-blocking `hook error` and the session
continues without sending anything.

## Warnings

When a hook cannot send, it shows one line in the session instead of staying silent: Node.js older than 18,
a failed restart of the hook process, sending not set up (`/harnessforce:setup`), an endpoint that is set
but not allowed, and a session registration that failed with anything other than 401. The line appears
only at a session start that registers (`startup`, `clear`, `fork`), except for the two startup failures,
which appear at every session start. A missing key while `HARNESSFORCE_WORKSPACE_ID` is set shows nothing,
because `harnessforce otel-headers` already reports it.

## Session registration hooks

The `harnessforce` plugin registers each Claude Code session with Harnessforce so that runs can be
linked to issues. On `SessionStart` (`startup`, `clear`, `fork`) it sends the session ID and the git
repository, branch and commit of `cwd` to `POST <HARNESSFORCE_ENDPOINT>/v1/sessions`. On the first
prompt it sends the same registration again with the prompt ID. Prompts, responses and file
contents are never sent.

- For an organization, set `HARNESSFORCE_ENDPOINT` (the ingest base URL; `https:`, or `http:` only
  for `localhost`, `127.0.0.1` and `[::1]`) and `HARNESSFORCE_INGEST_KEY` (a Workspace ingest key) in
  the `env` of the managed settings file (`managed-settings.json` or `managed-settings.d/*.json` in
  the managed directory). The hook reads the Workspace key and its endpoint only from those files,
  never from the process environment, because a repository's `.claude/settings.json` can set
  environment variables. Values distributed through MDM or server-managed settings are not read.
  Hooks do not receive `OTEL_*` variables, so these are separate.
- Without a managed Workspace key, the hook sends to `HARNESSFORCE_ENDPOINT` from the environment with
  the user ingest key that `harnessforce init` stored for
  `HARNESSFORCE_WORKSPACE_ID`, reading it by running `harnessforce otel-headers` from `PATH` (1 second limit).
  With a user key and `HARNESSFORCE_ISSUE` (set by `harnessforce run`), the registration claims `source=cli`
  with that issue identifier. A Workspace key never claims `source=cli`.
- Requires Node.js 18 or later on `PATH`. The hook always exits 0: outside a git repository, without
  configuration, on errors, or after 2 seconds it gives up quietly and writes the reason to stderr
  (Claude Code's debug log). Without Node.js, Claude Code shows a non-blocking `hook error`.
- If the key is revoked, Claude Code shows once per session:
  組織の送信キーが失効しています。Workspaceの管理者に連絡してください (Workspace key) or
  送信キーが失効しています。`harnessforce init`を実行してください (user key)

## Config snapshot

At the same `SessionStart`, the hook also sends a config snapshot to
`POST <HARNESSFORCE_ENDPOINT>/v1/config-snapshots`, including outside a git repository. The snapshot
describes the agent configuration as a list of components. Each component has a kind, a scope and
an identifier, plus a SHA-256 hash:

- CLAUDE.md files and rules, skills, agents, commands and workflows, from the managed directory,
  `~/.claude` and the repository root.
- `hooks`, `permissions` and `model` from each settings file.
- MCP servers from `.mcp.json`, `~/.claude.json` and `managed-mcp.json`.
- The same kinds of component from enabled marketplace plugins in the plugin cache.

File contents, settings values and MCP server configuration (URLs, headers, environment) are never
sent, only their hashes. Nothing is sent when there are no components, and the snapshot is skipped
when collection takes over 1 second or finds more than 1,000 components. The collector lives in
`packages/agent-core/src/config`, shared with `harnessforce run` so it can compute the same snapshot ID.

## License

[Apache-2.0](../../LICENSE)
