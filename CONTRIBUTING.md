# Contributing

Thank you for helping improve harnessforce-agent. By participating you agree to follow the
[Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately as described in
[SECURITY.md](SECURITY.md), not in issues.

## Before you start

- Ask questions in [Discussions Q&A](https://github.com/lambda-script/harnessforce-agent/discussions/categories/q-a),
  not in issues. [SUPPORT.md](SUPPORT.md) lists every channel.
- Issues are for bugs you can reproduce. Open one with the bug report form unless one already exists.
- For a new feature or a large change in behavior, start a discussion in
  [Ideas](https://github.com/lambda-script/harnessforce-agent/discussions/categories/ideas) before you
  write code. The behavior of the plugin, the CLI and the semantic conventions follows the Harnessforce
  product specification, so a change that departs from it has to be agreed before it is implemented.

## Setup

Requirements: Node.js from [`.node-version`](.node-version) and pnpm (the version in `packageManager`
in `package.json`, for example through `corepack enable`).

```sh
pnpm install
HARNESSFORCE_BUILD_URL=http://localhost:3000 pnpm check
```

`pnpm check` runs lint (Biome), knip, typecheck, tests and build through Turborepo, the same gate as
CI. `HARNESSFORCE_BUILD_URL` is the optional `apps/web` base URL baked into the CLI and the plugin as
their default (`https://harnessforce.dev` when unset); any `https:` URL, or `http:` for localhost, works for
development. After `pnpm check`, CI also runs two checks that need the network:

- `node scripts/check-required-cli.mjs` (Linux and macOS) installs `@harnessforce/cli` at the plugin's
  `REQUIRED_CLI_VERSION` from npm and checks, through `--help` only, that it has every command and option
  the plugin's commands, skills and hook run. When the plugin starts using a newer command or option, raise
  `REQUIRED_CLI_VERSION` (and the version in `commands/setup.md`) to the first CLI release that has it.
- `npx @anthropic-ai/claude-code@<version> plugin validate --strict` validates the marketplace and the
  built plugin (`plugins/harnessforce/dist/npm`). It needs no login.

Useful narrower commands:

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
  path across package roots (Biome enforces this). Logic shared by `harnessforce` and the plugin hook belongs in
  `packages/agent-core`.
- **Node.js 18.** `@harnessforce/cli`, `@harnessforce/semconv` and the plugin hook run on Node.js 18,
  so do not use APIs added later.
- **Measure skill and command wording.** The tests pin the wording of the skills and commands, but only
  the [plugin evals](plugins/harnessforce/evals/README.md) show whether the agent follows it. A pull
  request that changes that wording pastes the eval summaries of `main` and of the branch.
- **Keep what a fix teaches.** When a fix shows a rule that must keep holding, add it where it will be
  checked again: a test, an eval case, or the product specification when the rule is part of the
  agreed behavior.

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
