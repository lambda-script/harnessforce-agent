# harnessforce-agent
Agent-side toolkit for Harnessforce: Claude Code plugin, CLI, and semantic conventions

## Session registration hooks

The `harnessforce` plugin registers each Claude Code session with Harnessforce so that runs can be
linked to issues. On `SessionStart` (`startup`, `clear`, `fork`) it sends the session ID and the git
repository, branch and commit of `cwd` to `POST <HARNESSFORCE_ENDPOINT>/v1/sessions`. On the first
prompt it sends the same registration again with the prompt ID. Prompts, responses and file
contents are never sent.

- Set `HARNESSFORCE_ENDPOINT` (the ingest base URL; `https:`, or `http:` only for `localhost`,
  `127.0.0.1` and `[::1]`) and `HARNESSFORCE_INGEST_KEY` (a Workspace ingest key), for example in the
  managed settings `env`. Hooks do not receive `OTEL_*` variables, so these are separate.
- Without `HARNESSFORCE_INGEST_KEY`, the hook uses the user ingest key that `hf init` stored for
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
`packages/cli/src/config`, so `hf run` can compute the same snapshot ID.

The hook scripts exist only in the build output. `HARNESSFORCE_BUILD_URL=<apps/web base URL> pnpm build`
writes a marketplace directory to
`plugins/harnessforce/dist/marketplace`; register it with
`/plugin marketplace add <absolute path to plugins/harnessforce/dist/marketplace>` and then
`/plugin install harnessforce@harnessforce-agent`. The copy of the plugin in this repository has no
hooks. Public distribution starts once the production domain is decided.

## CLI credentials (`hf init`, `hf otel-headers`)

`hf init [--url <base URL>]` connects this machine to a Harnessforce Workspace:

1. It checks the OS keychain first: macOS Keychain, the Secret Service on Linux, or the Windows
   Credential Manager (through [`@napi-rs/keyring`](https://github.com/Brooooooklyn/keyring-node)).
   Without one it stops. Keys are never written to a plain file.
2. It logs in with the browser: OAuth 2.0 authorization code with PKCE, a `127.0.0.1` loopback
   redirect, the endpoint discovered from `/.well-known/oauth-authorization-server`, and a 5 minute
   wait. If the browser cannot be opened, it prints the URL.
3. It asks `POST <base URL>/api/v1/cli/credentials` for a user ingest key and an API token. It also
   sends the SHA-256 hashes of the ingest keys already in the keychain, so the old key for the chosen
   Workspace on this machine is revoked. Keys on other machines stay valid.
4. It stores both under the keychain service `harnessforce` as `<workspace_id>:ingest-key` and
   `<workspace_id>:api-token`.
5. It updates the Claude Code user settings (`~/.claude/settings.json`, or `$CLAUDE_CONFIG_DIR`),
   changing only these keys:
   - `env`: the OTel exporter variables, `HARNESSFORCE_URL`, `HARNESSFORCE_ENDPOINT` and
     `HARNESSFORCE_WORKSPACE_ID`, but no key
   - `otelHeadersHelper`: `hf otel-headers`
   - `enabledPlugins["harnessforce@harnessforce-agent"]`

`hf otel-headers` prints `{"Authorization":"Bearer <key>"}`. The key is `HARNESSFORCE_INGEST_KEY`
when that is set, and otherwise the user key for `HARNESSFORCE_WORKSPACE_ID` from the keychain. If
there is no key, it prints nothing and exits 1.

The default base URL is a build input: `HARNESSFORCE_BUILD_URL=<apps/web base URL> pnpm build`.
The build fails without it. The value must be `https:`, or `http:` for localhost.

## Releasing

Publishing to npmjs is disabled until the npm scope exists. To enable it:

1. Decide the scope. It lives only in `package.json` → `config.npmScope` (currently `@harnessforce`).
   To change it, edit that value, run `pnpm scope:apply`, and commit the result.
2. Create the npm organization for that scope on npmjs.com.
3. Create a granular access token with read/write on that scope (publish must bypass 2FA), then:
   `gh secret set NPM_TOKEN -R lambda-script/harnessforce-agent`
4. In repository Settings → Actions → General, allow GitHub Actions to create pull requests.
5. `gh variable set NPM_PUBLISH_ENABLED --body true -R lambda-script/harnessforce-agent`
6. Provide the production `HARNESSFORCE_BUILD_URL` to the `Release` workflow (the CLI build fails
   without it), then re-run the latest `Release` workflow on `main`. It publishes 0.1.0 with provenance and fails
   unless `npm view <scope>/semconv@0.1.0 version` and `npm view <scope>/cli@0.1.0 version` resolve.
7. Confirm the provenance badge on each package page on npmjs.com.

Later releases: add a changeset (`pnpm changeset`) in the Delivery PR. Merging to `main` opens the
"chore: version packages" PR, and merging that PR publishes the packages.
