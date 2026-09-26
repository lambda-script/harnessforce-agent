# harnessforce-agent
Agent-side toolkit for Harnessforce: Claude Code plugin, CLI, and semantic conventions

## Releasing

Publishing to npmjs is disabled until the npm scope exists. To enable it:

1. Decide the scope. It lives only in `package.json` → `config.npmScope` (currently `@harnessforce`).
   To change it, edit that value, run `pnpm scope:apply`, and commit the result.
2. Create the npm organization for that scope on npmjs.com.
3. Create a granular access token with read/write on that scope (publish must bypass 2FA), then:
   `gh secret set NPM_TOKEN -R lambda-script/harnessforce-agent`
4. In repository Settings → Actions → General, allow GitHub Actions to create pull requests.
5. `gh variable set NPM_PUBLISH_ENABLED --body true -R lambda-script/harnessforce-agent`
6. Re-run the latest `Release` workflow on `main`. It publishes 0.1.0 with provenance and fails
   unless `npm view <scope>/semconv@0.1.0 version` and `npm view <scope>/cli@0.1.0 version` resolve.
7. Confirm the provenance badge on each package page on npmjs.com.

Later releases: add a changeset (`pnpm changeset`) in the Delivery PR. Merging to `main` opens the
"chore: version packages" PR, and merging that PR publishes the packages.
