# harnessforce-agent
Agent-side toolkit for Harnessforce: Claude Code plugin, CLI, and semantic conventions

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
  the user ingest key that `hf init` stored for
  `HARNESSFORCE_WORKSPACE_ID`, reading it by running `hf otel-headers` from `PATH` (1 second limit).
  With a user key and `HARNESSFORCE_ISSUE` (set by `hf run`), the registration claims `source=cli`
  with that issue identifier. A Workspace key never claims `source=cli`.
- Requires Node.js 18 or later on `PATH`. The hook always exits 0: outside a git repository, without
  configuration, on errors, or after 2 seconds it gives up quietly and writes the reason to stderr
  (Claude Code's debug log). Without Node.js, Claude Code shows a non-blocking `hook error`.
- If the key is revoked, Claude Code shows once per session:
  組織の送信キーが失効しています。Workspaceの管理者に連絡してください (Workspace key) or
  送信キーが失効しています。`hf init`を実行してください (user key)

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
`packages/agent-core/src/config`, shared with `hf run` so it can compute the same snapshot ID.

## Plugin build output

`HARNESSFORCE_BUILD_URL=<apps/web base URL> pnpm build` writes a marketplace directory to
`plugins/harnessforce/dist/marketplace`. The build fails without the URL. The same value becomes the
default connection of `hf` and the plugin's MCP server URL, so the two never disagree. The plugin in
the output contains:

- `hooks/hooks.json` and `scripts/`: the session registration hooks above.
- `.mcp.json`: the Harnessforce MCP server `harnessforce` at `<HARNESSFORCE_BUILD_URL>/mcp` over HTTP.
  Claude Code asks you to log in with the browser and pick a Workspace the first time a tool is used.
- `skills/record-run/SKILL.md`: an [Agent Skills](https://agentskills.io) skill that tells the agent to
  register the session with `start_run`, read the issue with `get_issue`, record a plan with
  `record_plan` when there is none, record decisions with `record_decision`, and report the Definition
  of Done with `complete_run`.
- `commands/setup.md` (`/harnessforce:setup`): checks for Node.js 18 or later, installs the CLI, runs
  `hf init` and `hf import`, asks you to restart Claude Code, and after the restart helps you confirm
  that the first event arrived.
- `cli/`: the `@harnessforce/cli` and `@harnessforce/semconv` tarballs from the same build.
  `/harnessforce:setup` in the build output installs these
  (`npm install -g <semconv tarball> <cli tarball>`) instead of the CLI on npm.

Register the output with
`/plugin marketplace add <absolute path to plugins/harnessforce/dist/marketplace>`, then run
`/plugin install harnessforce@harnessforce-agent` and `/harnessforce:setup`. The copy of the plugin in
this repository has no hooks and no MCP server, and its `/harnessforce:setup` installs
`@harnessforce/cli` from npm. Public distribution starts once the production domain is decided.

## CLI credentials (`hf init`, `hf otel-headers`)

`hf init [--url <base URL>]` connects this machine to a Harnessforce Workspace:

1. It checks the OS keychain first: macOS Keychain, the Secret Service on Linux, or the Windows
   Credential Manager (through [`@napi-rs/keyring`](https://github.com/Brooooooklyn/keyring-node)).
   Without one it stops. Keys are never written to a plain file.
2. It logs in with the browser: OAuth 2.0 authorization code with PKCE, a `127.0.0.1` loopback
   redirect, the endpoint discovered from `/.well-known/oauth-authorization-server`, and a 5 minute
   wait. If the browser cannot be opened, it prints the URL.
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
     `HARNESSFORCE_WORKSPACE_ID`, but no key
   - `otelHeadersHelper`: `hf otel-headers`
   - `enabledPlugins["harnessforce@harnessforce-agent"]`

`hf otel-headers` prints `{"Authorization":"Bearer <key>"}`. The key is `HARNESSFORCE_INGEST_KEY` from
the managed settings file when that is set, and otherwise the user key for
`HARNESSFORCE_WORKSPACE_ID` from the keychain. If
there is no key, it prints nothing and exits 1. The user key is printed only when every destination
variable that is set (`HARNESSFORCE_ENDPOINT`, `OTEL_EXPORTER_OTLP_ENDPOINT` and the per-signal
`OTEL_EXPORTER_OTLP_*_ENDPOINT`) has the pinned origin. This stops a repository's
`.claude/settings.json` `env` from pointing the hook at another host to collect the key. Otherwise it
writes `harnessforce: user key withheld (destination not verified)` to stderr and exits 1. Run
`hf init` again to re-pin.

### Refreshing the API token

`hf import` and `hf run --issue` call the Read API with the access token. When it has expired, or the
Read API answers 401 once, they take `~/.harnessforce/token.lock`, read the keychain again (another
process may have refreshed already), and exchange the refresh token at the `token_endpoint` from the
authorization server metadata of the base URL, only when that endpoint is on the pinned base URL
origin. The new pair replaces `<workspace_id>:api-token`. A lock older than 60 seconds is treated as
abandoned, and waiting more than 30 seconds for it counts as a failed refresh. If the refresh fails, or
the refreshed token is also answered with 401, they stop with
「ログインの有効期限が切れました。`hf init`を実行してください」.

The default base URL is a build input: `HARNESSFORCE_BUILD_URL=<apps/web base URL> pnpm build`.
The build fails without it. The value must be `https:`, or `http:` for localhost. The plugin build
uses the same value for its MCP server URL.

## Launching an agent for an Issue (`hf run`)

`hf run --issue <identifier> -- <agent> [args]` links the session to an Issue before it starts:

1. It reads the Read API base URL (`HARNESSFORCE_URL`, then `env.HARNESSFORCE_URL` in the Claude Code user
   settings, then the build default), the ingest endpoint (`HARNESSFORCE_ENDPOINT`, then the user
   settings) and the Workspace (`HARNESSFORCE_WORKSPACE_ID`, then the user settings). Before sending
   anything it checks, in order: the keychain, the Workspace, its user key, the ingest endpoint and its
   scheme, the ingest origin pinned by `hf init`, the API token, the Read API scheme, and the Read API
   origin pinned by `hf init`. The first failed check stops it, usually asking you to run `hf init`.
2. It resolves the Issue with `GET /api/v1/issues/{identifier}` and the stored API token. If the Issue
   does not exist, it prints up to 10 candidates from `GET /api/v1/issues?query=<identifier>` and stops.
3. It computes the config snapshot ID locally with the same collection as the SessionStart hook.
4. It starts the agent with `HARNESSFORCE_WORKSPACE_ID`, `HARNESSFORCE_ENDPOINT`,
   `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`, telemetry and traces
   enabled, `HARNESSFORCE_ISSUE`, and `OTEL_RESOURCE_ATTRIBUTES` carrying `hf.issue.identifier`,
   `hf.vcs.repository`, `hf.vcs.branch`, `hf.vcs.commit` and `hf.agent.config_version`. It removes
   `OTEL_EXPORTER_OTLP_HEADERS` and the per-signal `*_HEADERS`, `*_ENDPOINT` and `*_PROTOCOL` variables
   inherited from the shell. The user key and the API token are never put in the agent's environment,
   arguments or settings: Claude Code gets the key only through `otelHeadersHelper` (`hf otel-headers`).
5. For Claude Code (`claude`), the same values also go in a settings file passed as
   `--settings <absolute path>` before your arguments, because settings files can override the shell.
   The file is created with mode 0600 in the temp directory and deleted when the agent exits.
   `HARNESSFORCE_ISSUE` tells the plugin hook to register the session with `source=cli`.
6. The agent is found on `PATH` (with `PATHEXT` on Windows), or used as given when the command contains a
   path separator. On Windows, `.cmd` and `.bat` files (such as npm's `claude.cmd`) are started through
   `%ComSpec% /d /s /c` with every argument quoted; arguments containing `"`, `%`, `!` or a newline are
   refused.

It exits with the agent's exit code. Prompt and body logging are never turned on.

## Importing past sessions (`hf import`)

`hf import` sends metadata of past Claude Code sessions on this machine to Harnessforce, so that
work done before the plugin was installed can be linked to issues too. Run `hf init` first.

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
  `hf init`; otherwise nothing is sent and it asks you to run `hf init`.
- Sessions are sent 100 at a time to `POST <HARNESSFORCE_ENDPOINT>/v1/imports/sessions` with the user
  ingest key, only when the endpoint origin matches the one pinned by `hf init`. `429` and `503` are
  retried up to 3 times after `Retry-After` (at most 60 seconds).
- Sent sessions are recorded in `~/.harnessforce/import-state.json` per Workspace and ingest endpoint,
  so running it again continues where it stopped and never sends a session twice to the same place.
  Sessions dropped because of the monthly event limit or a read-only Workspace are not recorded and
  are sent by a later run.

The Workspace, the connection URL and the ingest endpoint come from `HARNESSFORCE_WORKSPACE_ID`,
`HARNESSFORCE_URL` and `HARNESSFORCE_ENDPOINT` in the environment, and otherwise from the `env` that
`hf init` wrote to the Claude Code user settings.

## Releasing

Publishing to npmjs is disabled until the production domain is recorded in the Harnessforce
`docs/specs/infrastructure/environments.md` ("接続先") and the npm scope exists. Until the domain is
recorded, that spec keeps distributing the plugin and the CLI to the public out of scope. To enable it:

1. Confirm the production domain is recorded in `environments.md`. Do not continue before it is.
2. Create the `@harnessforce` npm organization on npmjs.com.
3. The `Release` workflow authenticates to npm only through trusted publishing (OIDC); the repository
   holds no npm token. npm attaches a trusted publisher only to a package that already exists, so a
   maintainer with 2FA publishes each of `@harnessforce/semconv` and `@harnessforce/cli` once as a
   placeholder: from an empty directory holding only a `package.json` with that `name`, the version
   `0.0.0-bootstrap.0` and the same `repository` as `packages/<name>/package.json`, run
   `npm publish --access public`.
4. Attach the trusted publisher to each package (npm 11.15.0 or later, 2FA required):
   `npm trust github @harnessforce/<name> --repository lambda-script/harnessforce-agent --file release.yml --allow-publish`
5. In repository Settings → Actions → General, allow GitHub Actions to create pull requests.
6. Set the CLI's default connection URL as a repository variable. The `Release` workflow passes
   `vars.HARNESSFORCE_BUILD_URL` to the build, which bakes it into `@harnessforce/cli`
   (`packages/cli/scripts/build-config.mjs`) and fails when it is missing, so a release never falls back
   to a default. Use the production `apps/web` base URL once it is recorded in the Harnessforce
   `docs/specs/infrastructure/environments.md` ("接続先"); staging builds must not be published:
   `gh variable set HARNESSFORCE_BUILD_URL --body https://<apps/web host> -R lambda-script/harnessforce-agent`
7. `gh variable set NPM_PUBLISH_ENABLED --body true -R lambda-script/harnessforce-agent`
8. Re-run the latest `Release` workflow on `main`. It publishes 0.1.0 with provenance and fails
   unless `npm view @harnessforce/semconv@0.1.0 version` and `npm view @harnessforce/cli@0.1.0 version` resolve.
9. Confirm the provenance badge on each package page on npmjs.com, then deprecate the placeholders:
   `npm deprecate @harnessforce/<name>@0.0.0-bootstrap.0 "placeholder for trusted publishing setup"`

Later releases: add a changeset (`pnpm changeset`) in the Delivery PR. Merging to `main` opens the
"chore: version packages" PR, and merging that PR publishes the packages.
