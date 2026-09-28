# Building the local marketplace

Until the production domain is recorded in the Harnessforce `docs/specs/infrastructure/environments.md`
("接続先"), the plugin and the CLI are not distributed to the public. Internal testers and developers
build them from this repository against a staging or local `apps/web` and install the build output.
Staging builds are never published to npm or committed to the marketplace in this repository.

## Build

```sh
pnpm install
HARNESSFORCE_BUILD_URL=<apps/web base URL> pnpm build
```

`HARNESSFORCE_BUILD_URL` must be `https:`, or `http:` for `localhost`, `127.0.0.1` and `[::1]`. The
build fails without it and never falls back to a default. The same value becomes the default connection
of `hf` and the plugin's MCP server URL, so the two never disagree; the plugin build fails if
`packages/cli` was built with a different value.

The build writes a marketplace directory to `plugins/harnessforce/dist/marketplace`. The plugin in it
contains:

- `hooks/hooks.json` and `scripts/`: the session registration hooks (see the
  [plugin README](../../plugins/harnessforce/README.md)).
- `.mcp.json`: the Harnessforce MCP server `harnessforce` at `<HARNESSFORCE_BUILD_URL>/mcp` over HTTP.
  Claude Code asks you to log in with the browser and pick a Workspace the first time a tool is used.
- `skills/record-run/SKILL.md`: the skill that records a run through the MCP tools.
- `commands/setup.md` (`/harnessforce:setup`).
- `cli/`: the `@harnessforce/cli` and `@harnessforce/semconv` tarballs from the same build.
  `/harnessforce:setup` in the build output installs these
  (`npm install -g <semconv tarball> <cli tarball>`) instead of the CLI on npm.

The copy of the plugin in this repository has no hooks and no MCP server, and its
`/harnessforce:setup` installs `@harnessforce/cli` from npm.

## Install on your machine

In Claude Code:

```text
/plugin marketplace add <absolute path to plugins/harnessforce/dist/marketplace>
/plugin install harnessforce@harnessforce-agent
/harnessforce:setup
```

`/harnessforce:setup` checks for Node.js 18 or later, installs the CLI from the build output, runs
`hf init` and `hf import`, and asks you to restart Claude Code. Run it again after the restart to
confirm that the first event arrived.

## Distribute to an organization

In the managed settings, set the marketplace source to
`{"source": "directory", "path": "<absolute path to the build output>"}` under
`extraKnownMarketplaces["harnessforce-agent"]` and enable `harnessforce@harnessforce-agent` in
`enabledPlugins`. Every machine must have the build output at the same absolute path.
