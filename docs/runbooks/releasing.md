# Releasing

Publishing to npmjs is disabled until the production domain is recorded in the Harnessforce
`docs/specs/infrastructure/environments.md` ("接続先") and the npm scope exists. Until the domain is
recorded, that spec keeps distributing the plugin and the CLI to the public out of scope.

## Enabling publishing (once)

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

## Every release

1. Each pull request that changes what users of `@harnessforce/cli` or `@harnessforce/semconv` see
   carries a changeset (`pnpm changeset`). Private packages (`@harnessforce/agent-core`,
   `@harnessforce/test-support`, `harnessforce-plugin`) are never published and need none.
2. Merging to `main` makes the `Release` workflow open or update the "chore: version packages" pull
   request, which bumps the versions and writes the changelogs.
3. Merging that pull request runs `pnpm run release` (`turbo run build && changeset publish`), which
   publishes the new versions with provenance through trusted publishing.
4. The workflow then runs `scripts/verify-published.mjs`, which fails unless every published version
   resolves with `npm view <name>@<version> version`. A merged version pull request alone does not
   mean the release succeeded: check that the `Release` run is green.

The plugin is not published to npm. Once public distribution starts, users add the marketplace in this
repository. Until then, internal testers use the build output described in
[Building the local marketplace](./local-marketplace.md).
