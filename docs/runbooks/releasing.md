# Releasing

Publishing to npmjs is disabled until the production domain is recorded in the Harnessforce
`docs/specs/infrastructure/environments.md` (the connection destination section) and the npm scope exists. Until the domain is
recorded, that spec keeps distributing the plugin and the CLI to the public out of scope.

## Enabling publishing (once)

1. Confirm the production domain is recorded in `environments.md`. Do not continue before it is.
2. Create the `@harnessforce` npm organization on npmjs.com.
3. The `Release` workflow authenticates to npm only through trusted publishing (OIDC); the repository
   holds no npm token. npm attaches a trusted publisher only to a package that already exists, so a
   maintainer with 2FA publishes each of `@harnessforce/semconv`, `@harnessforce/cli` and
   `@harnessforce/claude-code-plugin` once as a
   placeholder: from an empty directory holding only a `package.json` with that `name`, the version
   `0.0.0-bootstrap.0` and the same `repository` as `packages/<name>/package.json`, run
   `npm publish --access public`.
4. In repository Settings → Environments, create the `release` environment that the `Release` job runs in, and
   set its Deployment branches and tags to Selected branches and tags with the single branch rule `main`. Then
   attach the trusted publisher to each package, bound to that environment (npm 11.15.0 or later, 2FA required):
   `npm trust github @harnessforce/<name> --repository lambda-script/harnessforce-agent --file release.yml --environment release --allow-publish`
   npm then accepts only an OIDC token from `release.yml` running in the `release` environment, and GitHub runs
   that environment only from `main`, so a `release.yml` pushed to any other branch cannot publish. Do not attach
   a trusted publisher without `--environment release`, and do not widen the environment's branch rule.
5. In repository Settings → Actions → General, allow GitHub Actions to create pull requests.
6. Do not set `HARNESSFORCE_BUILD_URL`. The `Release` workflow does not pass it, so the build bakes the
   production default `https://harnessforce.dev` into `@harnessforce/cli` and the plugin
   (`packages/cli/scripts/build-config.mjs`); a staging or local URL is for development builds only.
   `pnpm run release` runs `scripts/check-publish-build.mjs` between the build and `changeset publish`; it
   fails unless `packages/cli/dist/build-config.json` has `isDefault: true` and the plugin's `.mcp.json`
   defaults to `https://harnessforce.dev`, so a build with another connection URL is never published.
7. Confirm the packages do not expose `hf`. The Hugging Face CLI uses that name, so `packages/cli/package.json`
   lists only `harnessforce` in `bin`. `scripts/check-first-release.mjs` fails the `Release` workflow while an
   unpublished package still exposes `hf`.
8. `gh variable set NPM_PUBLISH_ENABLED --body true -R lambda-script/harnessforce-agent`
9. Re-run the latest `Release` workflow on `main`. It publishes 0.1.0 with provenance and fails
   unless `npm view @harnessforce/<name>@0.1.0 version` resolves for `semconv`, `cli` and `claude-code-plugin`.
   The Harnessforce spec (`semantic-conventions.md`) makes 0.1.0 the first published version, and the
   Harnessforce service switches to `@harnessforce/semconv` once 0.1.0 is on npm.
   Until `@harnessforce/<name>@0.1.0` is on npm, do not add a changeset for that package: the changes
   up to the first release are all part of 0.1.0. With no changeset pending, `changesets/action` publishes the
   version in `package.json` instead of opening a version pull request.
   `scripts/check-first-release.mjs` runs before `changesets/action` and fails the workflow when a
   package without 0.1.0 on npm is not at 0.1.0 or has a pending changeset.
10. Confirm the provenance badge on each package page on npmjs.com, then deprecate the placeholders:
   `npm deprecate @harnessforce/<name>@0.0.0-bootstrap.0 "placeholder for trusted publishing setup"`

## Every release

1. After the first release, each pull request that changes what users of `@harnessforce/cli`,
   `@harnessforce/semconv` or `@harnessforce/claude-code-plugin` see carries a changeset (`pnpm changeset`). Before it, see step 8 above. Private packages (`@harnessforce/agent-core`,
   `@harnessforce/test-support`) are never published and need none.
2. Merging to `main` makes the `Release` workflow open or update the "chore: version packages" pull
   request, which bumps the versions and writes the changelogs.
3. Merging that pull request runs `pnpm run release` (`turbo run build && changeset publish`), which
   publishes the new versions with provenance through trusted publishing.
4. The workflow then runs `scripts/verify-published.mjs`, which fails unless every published version
   resolves with `npm view <name>@<version> version`. A merged version pull request alone does not
   mean the release succeeded: check that the `Release` run is green.

## The plugin package

`@harnessforce/claude-code-plugin` is `plugins/harnessforce`. Its `publishConfig.directory` makes
`pnpm publish` pack `plugins/harnessforce/dist/npm`, the plugin build output, instead of the source
directory. That output holds no CLI tarball and no `bin`; its `/harnessforce:setup` installs
`@harnessforce/cli` from npm. The same build also writes `dist/marketplace`, the local marketplace form
that does bundle the tarballs (see [Building the local marketplace](./local-marketplace.md)); only
`dist/npm` is published.

The marketplace definition in this repository (`.claude-plugin/marketplace.json`) installs the plugin
from npm: its source is `{"source": "npm", "package": "@harnessforce/claude-code-plugin"}` with no
version, so Claude Code takes the latest published version and a release reaches users without a
change to the marketplace. Do not point the source back at the source tree: the tree has no hooks and
no MCP server.
