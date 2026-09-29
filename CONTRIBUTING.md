# Contributing

Thank you for helping improve harnessforce-agent. By participating you agree to follow the
[Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately as described in
[SECURITY.md](SECURITY.md), not in issues.

## Before you start

- For a bug, open an issue with the bug report template unless one already exists.
- For a new feature or a change in behavior, open an issue first. The behavior of the plugin, the CLI
  and the semantic conventions follows the Harnessforce product specification, so a change that
  departs from it has to be agreed before it is implemented.

## Setup

Requirements: Node.js from [`.node-version`](.node-version) and pnpm (the version in `packageManager`
in `package.json`, for example through `corepack enable`).

```sh
pnpm install
HARNESSFORCE_BUILD_URL=http://localhost:3000 pnpm check
```

`pnpm check` runs lint (Biome), knip, typecheck, tests and build through Turborepo, the same gate as
CI. The build needs `HARNESSFORCE_BUILD_URL`, the `apps/web` base URL baked into the CLI and the
plugin; any `https:` URL, or `http:` for localhost, works for development. Useful narrower commands:

```sh
pnpm format                                   # format with Biome
pnpm turbo run test --filter=@harnessforce/cli
pnpm --filter @harnessforce/cli exec vitest run test/run/run.test.ts
```

The plugin tests run against the build output, so `turbo` builds before testing; when running Vitest
directly in `plugins/harnessforce`, run `pnpm build` first.

## Writing changes

- **Test first.** For every change in behavior, write a failing test, see it fail, then make it pass
  with the smallest change. Bug fixes start with a test that reproduces the bug.
- **Keep the scope small.** One pull request solves one problem. Do not mix unrelated refactoring,
  renaming or formatting into it.
- **Comments explain why.** Code should say what it does; comments give the reason, the constraint or
  the spec section behind it. Do not leave change-history comments or commented-out code.
- **Respect package boundaries.** Import another workspace package by its name, never by a relative
  path across package roots (Biome enforces this). Logic shared by `hf` and the plugin hook belongs in
  `packages/agent-core`.
- **Node.js 18.** `@harnessforce/cli`, `@harnessforce/semconv` and the plugin hook run on Node.js 18,
  so do not use APIs added later.

## Commits and branches

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
`<type>(<scope>): <description>`, with the scope optional. The description is English, imperative,
lowercase and has no trailing period.

| Type | Use |
| --- | --- |
| `feat` | A new feature |
| `fix` | A bug fix |
| `refactor` | An internal change that does not change behavior |
| `docs` | Documentation |
| `test` | Tests |
| `chore` | Build, dependencies and maintenance |
| `perf` | Performance |
| `ci` | CI configuration |

Pull requests are squash merged, so the pull request title becomes the commit on `main` and must follow
the same format.

Name branches `<prefix>/<topic>`, where the prefix is one of `feature`, `bugfix`, `hotfix`, `docs`,
`refactor`, `test`, `chore`, `perf` or `ci`, and the topic uses lowercase letters, digits and hyphens
(for example `bugfix/import-empty-key`).

No Developer Certificate of Origin sign-off or contributor license agreement is required.
Contributions are accepted under the [Apache License 2.0](LICENSE).

## Changesets

If your change affects users of a published package (`@harnessforce/cli` or `@harnessforce/semconv`),
add a changeset:

```sh
pnpm changeset
```

Pick the packages and the bump (`patch` for fixes, `minor` for additions; see the
[semconv versioning rules](packages/semconv/README.md#versioning)), and write one sentence from the
user's point of view. Private packages (`@harnessforce/agent-core`, `@harnessforce/test-support` and
the plugin source) need no changeset. Until a package's 0.1.0 is on npm, add no changeset for it:
everything before the first release ships as 0.1.0. See [Releasing](docs/runbooks/releasing.md) for
what happens after merge.

## Pull requests

1. Make `HARNESSFORCE_BUILD_URL=http://localhost:3000 pnpm check` pass locally.
2. Fill in the pull request template, including how you tested the change.
3. Keep the pull request as a draft until it is ready for review.
4. Answer every review comment, with the commit that addresses it or the reason for not changing.
