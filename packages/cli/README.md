# @harnessforce/cli

`harnessforce`, the command line of [Harnessforce](https://github.com/lambda-script/harnessforce-agent). It
connects a machine to a Harnessforce Workspace, supplies the ingest key to Claude Code's OpenTelemetry
exporter, launches an agent linked to an Issue, and imports the metadata of past Claude Code sessions.

It is used together with the `harnessforce` Claude Code plugin, whose `/harnessforce:setup` installs
it. Public distribution on npm starts once the production domain of Harnessforce is decided; until
then, install it from the [local marketplace build](https://github.com/lambda-script/harnessforce-agent/blob/main/docs/runbooks/local-marketplace.md).

## Requirements

- Node.js 18 or later (the same Node.js the plugin hook uses).
- An OS keychain: macOS Keychain, the Secret Service on Linux, or the Windows Credential Manager.
  Keys and tokens are never written to a plain file.

## Install

```sh
npm install -g @harnessforce/cli
harnessforce init
```

## Commands

| Command | What it does |
| --- | --- |
| `harnessforce init [--url <base URL>] [--port <port>] [--send-content]` | Logs in with the browser, stores a user ingest key and an API token in the keychain, and configures Claude Code |
| `harnessforce otel-headers` | Prints the `Authorization` header for Claude Code's `otelHeadersHelper` |
| `harnessforce run --issue <identifier> -- <agent> [args]` | Launches an agent with its session linked to an Issue |
| `harnessforce import` | Sends the metadata of past Claude Code sessions in connected repositories |
| `harnessforce tune [--all] [--no-send] [--show-report] [--json]` | Analyzes past sessions on this machine by public rules and sends the counts (analysis reports) |
| `harnessforce tune record` / `harnessforce tune --purge` | Records a proposal from stdin / deletes everything under `~/.harnessforce/tune/` |
| `harnessforce top [--once] [--json] [--ascii] [--theme <auto\|light\|dark\|ansi>]` | Shows the Claude Code sessions on this machine in the terminal: state, tokens, context and tool failures. Reads only local files and never connects to Harnessforce |
| `harnessforce hook session-start` | The entry of Codex's `SessionStart` hook: reads `session_id`, `cwd` and `source` from stdin, registers the session, and prints the session ID for the agent's context. Always exits 0 |
| `harnessforce --version` | Prints the version |

Builds made before the first npm publish also install `hf` as an alias of `harnessforce`, so settings written
by `hf init` keep working until you run `harnessforce init` again. The alias is removed from the first published
version, because the Hugging Face CLI also uses the name `hf`.

## Watching your sessions (`harnessforce top`)

`harnessforce top` reads the Claude Code transcripts on this machine (the same place as `harnessforce import`) and shows
one row per session whose last event is within 24 hours. It needs no `harnessforce init`, makes no network
connection, never reads the keychain and writes nothing to disk. It shows counts, times, ids, the repository and
branch, model and tool names only: no prompt, response, tool input or output, path, command or error text, no cost and
no context percentage.

- A session is `active` when its last event is within 60 seconds, otherwise `idle`.
- Keys: `q` quit, `?` help, `↑` `↓` / `j` `k` select, `Enter` detail, `Esc` back, `/` filter, `s` order, `p` pause, `r` refresh.
- `--once` prints one plain-text table (no escapes). `--json` prints `{"sessions": [...]}`. A pipe or redirect behaves like `--once`.
- `--ascii` draws with ASCII characters only.
- The terminal background is never painted. Colors are foreground only, so a symbol and its label always carry the
  meaning. `--theme auto` asks the terminal for its background once (100 ms limit); when it answers, the colors of the
  Harnessforce web design system are used, and any color with less than 3:1 contrast on that background is left out.
  Without an answer, or with `--theme ansi`, the terminal's own 16 colors are used. `NO_COLOR` turns colors off.
- The screen restores the alternate screen and the cursor on `q`, Ctrl-C, SIGTERM, SIGHUP and a normal exit. A console that does not understand VT escape sequences is not detected: use `--once` or `--ascii` there.
- `~/.harnessforce/config.json` may set `{"top": {"ambiguous_width": 2, "braille": true}}`. An unreadable file or a
  value out of range falls back to the defaults and says so; the file is never written.

## Codex `SessionStart` hook (`harnessforce hook session-start`)

Codex runs this command through the `[[hooks.SessionStart]]` entry that `harnessforce init` writes into Codex's
`config.toml`. It uses only `session_id`, `cwd` and `source` from the JSON on stdin, and:

- sends the session registration (`agent` is `codex`) only when `source` is `startup`, `clear` or missing, and
  only to the ingest origin that `harnessforce init` pinned, with the user ingest key from the keychain. The
  Workspace and the endpoint come from `HARNESSFORCE_WORKSPACE_ID` and `HARNESSFORCE_ENDPOINT`, or from the
  Claude Code user settings that `harnessforce init` wrote. When `HARNESSFORCE_ISSUE` is a valid identifier
  (`harnessforce run --issue` sets it), the registration claims `source=cli` with that Issue.
- prints `{"hookSpecificOutput": {...}}` carrying `harnessforce session_id: <id>` so the agent knows its session
  ID. When the key was revoked (401) it prints that line and the message as plain text instead, and writes the
  message to stderr.
- never fails the session: any error ends with exit code 0, and nothing is sent outside a git repository.

## What is never sent

Harnessforce never turns on prompt or body logging by itself. `harnessforce run` never turns it on, and `harnessforce init`
adds `OTEL_LOG_USER_PROMPTS=1` to the Claude Code user settings only with `--send-content`, and only
when the credentials response says the Workspace has opted in to content. Without that, prompts,
responses, tool inputs and outputs, and file contents are not sent. For a Workspace that has not opted
in, `harnessforce init --send-content` leaves the setting alone, prints the reason, and still exits 0. `harnessforce run`
never puts the user key or the API token in the agent's environment, arguments or settings. Keys and
tokens are sent only to the origins pinned by `harnessforce init`.

## CLI credentials (`harnessforce init`, `harnessforce otel-headers`)

`harnessforce init [--url <base URL>] [--port <port>] [--send-content]` connects this machine to a Harnessforce Workspace:

1. It checks the OS keychain first: macOS Keychain, the Secret Service on Linux, or the Windows
   Credential Manager (through [`@napi-rs/keyring`](https://github.com/Brooooooklyn/keyring-node)).
   Without one it stops. Keys are never written to a plain file.
2. It logs in with the browser: OAuth 2.0 authorization code with PKCE, a `127.0.0.1:8080` loopback
   redirect (`--port <port>` changes the port), the endpoint discovered from
   `/.well-known/oauth-authorization-server`, and a 5 minute wait. When the port is already in use it
   stops instead of moving to another port. If the browser cannot be opened, it prints the URL.
3. It asks `POST <base URL>/api/v1/cli/credentials` for a user ingest key and an API token (a 1 hour
   access token and a 90 day refresh token). It also sends the SHA-256 hashes of the ingest keys and of
   the API tokens' refresh tokens already in the keychain (at most 100 of each), so the old key and
   token for the chosen Workspace on this machine are revoked. Keys and tokens on other machines stay
   valid.
4. It stores both under the keychain service `harnessforce` as `<workspace_id>:ingest-key` and
   `<workspace_id>:api-token` (a JSON object with the access token, the refresh token and their
   expiries), and pins the ingest endpoint origin as `<workspace_id>:ingest-origin`
   and the base URL origin as `<workspace_id>:url-origin`. It deletes both origins first and writes
   them last, so a failure part way never pairs an old origin with a new key or token.
5. It updates the Claude Code user settings (`~/.claude/settings.json`, or `$CLAUDE_CONFIG_DIR`),
   changing only these keys:
   - `env`: the OTel exporter variables, `HARNESSFORCE_URL`, `HARNESSFORCE_ENDPOINT` and
     `HARNESSFORCE_WORKSPACE_ID`, but no key. With `--send-content` and a Workspace that has opted in
     to content it also adds `OTEL_LOG_USER_PROMPTS=1`
   - `otelHeadersHelper`: `harnessforce otel-headers`
   - `enabledPlugins["harnessforce@harnessforce-agent"]`

`harnessforce otel-headers` prints `{"Authorization":"Bearer <key>"}`. The key is `HARNESSFORCE_INGEST_KEY` from
the managed settings file when that is set, and otherwise the user key for
`HARNESSFORCE_WORKSPACE_ID` from the keychain. If
there is no key, it prints nothing and exits 1. The user key is printed only when every destination
variable that is set (`HARNESSFORCE_ENDPOINT`, `OTEL_EXPORTER_OTLP_ENDPOINT` and the per-signal
`OTEL_EXPORTER_OTLP_*_ENDPOINT`) has the pinned origin. This stops a repository's
`.claude/settings.json` `env` from pointing the hook at another host to collect the key. Otherwise it
writes `harnessforce: user key withheld (destination not verified)` to stderr and exits 1. Run
`harnessforce init` again to re-pin.

### Refreshing the API token

`harnessforce import` and `harnessforce run --issue` call the Read API with the access token. When it has expired, or the
Read API answers 401 once, they take `~/.harnessforce/token.lock`, read the keychain again (another
process may have refreshed already), and exchange the refresh token at the `token_endpoint` from the
authorization server metadata of the base URL, only when that endpoint is on the pinned base URL
origin. The new pair replaces `<workspace_id>:api-token`. A lock older than 60 seconds is treated as
abandoned, and waiting more than 30 seconds for it counts as a failed refresh. If the refresh fails, or
the refreshed token is also answered with 401, they stop with
「ログインの有効期限が切れました。`harnessforce init`を実行してください」.

### Default connection

The default base URL is a build input: `HARNESSFORCE_BUILD_URL=<apps/web base URL> pnpm build`.
The build fails without it. The value must be `https:`, or `http:` for localhost. The plugin build
uses the same value for its MCP server URL. See
[Building the local marketplace](https://github.com/lambda-script/harnessforce-agent/blob/main/docs/runbooks/local-marketplace.md).

## Launching an agent for an Issue (`harnessforce run`)

`harnessforce run --issue <identifier> -- <agent> [args]` links the session to an Issue before it starts:

1. It reads the Read API base URL (`HARNESSFORCE_URL`, then `env.HARNESSFORCE_URL` in the Claude Code user
   settings, then the build default), the ingest endpoint (`HARNESSFORCE_ENDPOINT`, then the user
   settings) and the Workspace (`HARNESSFORCE_WORKSPACE_ID`, then the user settings). Before sending
   anything it checks, in order: the keychain, the Workspace, its user key, the ingest endpoint and its
   scheme, the ingest origin pinned by `harnessforce init`, the API token, the Read API scheme, and the Read API
   origin pinned by `harnessforce init`. The first failed check stops it, usually asking you to run `harnessforce init`.
2. It resolves the Issue with `GET /api/v1/issues/{identifier}` and the stored API token. If the Issue
   does not exist, it prints up to 10 candidates from `GET /api/v1/issues?query=<identifier>` and stops.
3. It computes the config snapshot ID locally with the same collection as the SessionStart hook.
4. It starts the agent with `HARNESSFORCE_WORKSPACE_ID`, `HARNESSFORCE_ENDPOINT`,
   `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`, telemetry and traces
   enabled, `HARNESSFORCE_ISSUE`, and `OTEL_RESOURCE_ATTRIBUTES` carrying `hf.issue.identifier`,
   `hf.vcs.repository`, `hf.vcs.branch`, `hf.vcs.commit` and `hf.agent.config_version`. It removes
   `OTEL_EXPORTER_OTLP_HEADERS` and the per-signal `*_HEADERS`, `*_ENDPOINT` and `*_PROTOCOL` variables
   inherited from the shell. The user key and the API token are never put in the agent's environment,
   arguments or settings: Claude Code gets the key only through `otelHeadersHelper` (`harnessforce otel-headers`).
5. For Claude Code (`claude`), the same values also go in a settings file passed as
   `--settings <absolute path>` before your arguments, because settings files can override the shell.
   The file is created with mode 0600 in the temp directory and deleted when the agent exits.
   `HARNESSFORCE_ISSUE` tells the plugin hook to register the session with `source=cli`.
6. The agent is found on `PATH` (with `PATHEXT` on Windows), or used as given when the command contains a
   path separator. On Windows, `.cmd` and `.bat` files (such as npm's `claude.cmd`) are started through
   `%ComSpec% /d /s /c` with every argument quoted; arguments containing `"`, `%`, `!` or a newline are
   refused.

It exits with the agent's exit code. Prompt and body logging are never turned on.

## Importing past sessions (`harnessforce import`)

`harnessforce import` sends metadata of past Claude Code sessions on this machine to Harnessforce, so that
work done before the plugin was installed can be linked to issues too. Run `harnessforce init` first.

- It reads the transcripts in `~/.claude/projects/<project>/<session>.jsonl` (or
  `$CLAUDE_CONFIG_DIR/projects`). Their format is not documented, so the parser is versioned
  (`parser_version`), and unreadable lines and files are skipped and counted.
- Only these values are sent: session ID, first prompt ID, start and end time, repository, branch,
  the most used model, input and output token counts (without cache tokens), and the number of calls
  and failures per tool. Prompts, responses and tool inputs and outputs are never sent.
- Only sessions whose `cwd` is in a repository connected to the Workspace are sent. The connected
  repositories come from `GET <HARNESSFORCE_URL>/api/v1/repositories` (all pages) and the import
  window from `session_import_days` (`GET <HARNESSFORCE_URL>/api/v1/workspace`), both with the API
  token. The API token is sent only when the origin of `HARNESSFORCE_URL` matches the one pinned by
  `harnessforce init`; otherwise nothing is sent and it asks you to run `harnessforce init`.
- Sessions are sent 100 at a time to `POST <HARNESSFORCE_ENDPOINT>/v1/imports/sessions` with the user
  ingest key, only when the endpoint origin matches the one pinned by `harnessforce init`. `429` and `503` are
  retried up to 3 times after `Retry-After` (at most 60 seconds).
- Sent sessions are recorded in `~/.harnessforce/import-state.json` per Workspace and ingest endpoint,
  so running it again continues where it stopped and never sends a session twice to the same place.
  Sessions dropped because of the monthly event limit or a read-only Workspace are not recorded and
  are sent by a later run.

The Workspace, the connection URL and the ingest endpoint come from `HARNESSFORCE_WORKSPACE_ID`,
`HARNESSFORCE_URL` and `HARNESSFORCE_ENDPOINT` in the environment, and otherwise from the `env` that
`harnessforce init` wrote to the Claude Code user settings.

## Analyzing past sessions (`harnessforce tune`)

`harnessforce tune` reads the same transcripts as `harnessforce import` and turns each session into an analysis report:
interventions, loops that could be automated, and MCP server calls. Run `harnessforce init` first. The Viewer
role cannot use it.

- The categories come from public rules and a public vocabulary (`src/tune/analyze.ts`,
  `src/tune/vocabulary.ts`, `analyzer_version`), never from a model. Categories the transcript cannot
  tell apart (`approval`, `answer`) are reported as not measured, never as 0.
- Only the counts and medians of the analysis report are sent, to
  `POST <HARNESSFORCE_ENDPOINT>/v1/analysis-reports` with the user ingest key. Prompts, responses,
  commands, paths and error text never leave the machine.
- By default it analyzes sessions started in the last 30 days in connected repositories. `--all`
  analyzes every session, but still sends only sessions in connected repositories that started within
  `session_import_days`. Sessions without a Run are imported first, like `harnessforce import`.
- Sending is fail-open: when Harnessforce cannot be reached, the reports stay in
  `~/.harnessforce/tune/unsent.json` and are sent by the next run. `401` and `403` delete the unsent
  reports and ask you to run `harnessforce init`.
- `--no-send`, or `{"tune": {"send_report": false}}` in `~/.harnessforce/config.json`, sends nothing.
  A config file it cannot read also sends nothing.
- It also counts usage per session (auto and manual context compactions, responses, cache reuse
  ratio, output tokens per model in the main and subagent transcripts). These values are shown and
  written to `--json` and `~/.harnessforce/tune/analysis.json` only; they are never sent.
- `--json` also lists, for each recorded proposal whose application was detected, the value of its
  category in the 14 days before and after the detection time (`followups`). The difference is not
  a cause. Once a `--json` run outputs a follow-up whose after period has ended, later runs omit it.
- Everything it keeps is under `~/.harnessforce/tune/`; `harnessforce tune --purge` deletes it.

## License

[Apache-2.0](https://github.com/lambda-script/harnessforce-agent/blob/main/LICENSE)
