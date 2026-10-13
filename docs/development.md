# Development

Requirements: Node.js from [`.node-version`](../.node-version) and pnpm (the version in `packageManager`,
for example through `corepack enable`).

```sh
pnpm install
HARNESSFORCE_BUILD_URL=http://localhost:3000 pnpm check
```

`pnpm check` runs lint (Biome), knip, typecheck, tests (Vitest) and build through Turborepo, as CI does.
`HARNESSFORCE_BUILD_URL` is the optional `apps/web` base URL baked into the CLI and the plugin as their
default; without it the build uses `https://harnessforce.dev`. `http://localhost:3000` is the value CI uses. CI also runs the tests on macOS,
Windows and Node.js 24, and runs the built CLI and hook on Node.js 18.

| Path | Contents |
| --- | --- |
| `packages/*` | Workspace packages (see [Packages](../README.md#packages)) |
| `plugins/harnessforce` | Plugin source and its build (`build.mjs`) |
| `.claude-plugin/marketplace.json` | The `harnessforce-agent` marketplace |
| `scripts/` | Release scripts |
| `tests/` | Repository-wide contract tests |
| `docs/runbooks/` | Operator procedures |

See [CONTRIBUTING.md](../CONTRIBUTING.md) before opening a pull request.

## Pointing `harnessforce` at another environment

Customers only use the production Harnessforce, so the override below is not in the usage that
`harnessforce` prints or in the user-facing READMEs. It is for developers and testers.

- `harnessforce init --url <base URL>` connects to another `apps/web` (`https:`, or `http:` for `localhost`,
  `127.0.0.1` and `[::1]`). The URL is recorded as `env.HARNESSFORCE_URL` in the Claude Code user
  settings and its origin is pinned in the keychain. `harnessforce init` then prints
  `接続先: <URL>（既定の本番ではありません）` before its success message; it prints nothing extra when the
  connection is the build default.
- `HARNESSFORCE_URL` in the environment overrides the recorded Read API base URL for `harnessforce run` and
  `harnessforce import`, and the MCP server URL of the plugin. The API token is still sent only to the
  origin pinned by `harnessforce init`.
- The default connection is a build input: `HARNESSFORCE_BUILD_URL=<apps/web base URL> pnpm build`
  (`https://harnessforce.dev` when unset). The plugin build uses the same value for its MCP server URL. See
  [Building the local marketplace](runbooks/local-marketplace.md).
