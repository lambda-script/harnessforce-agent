# Security policy

## Reporting a vulnerability

Do not open a public issue, pull request or discussion for a vulnerability.

Report it privately through GitHub Security Advisories:
[Report a vulnerability](https://github.com/lambda-script/harnessforce-agent/security/advisories/new)
(the **Security** tab of this repository, then **Report a vulnerability**).

Please include:

- The affected package (`@harnessforce/cli`, `@harnessforce/semconv` or the `harnessforce` plugin) and
  version or commit.
- What an attacker can do, and the steps or a proof of concept to reproduce it.
- Your operating system and Node.js version, if relevant.

We will acknowledge the report, keep you informed while we investigate and fix it, and credit you in
the advisory unless you prefer otherwise.

## Supported versions

Only the latest release of each package, and the `main` branch, receive security fixes.

## Scope

This repository contains the code that runs on a developer's machine. Issues of particular interest
include:

- A key or token (the Workspace ingest key, the user ingest key or the API token) leaking to a
  destination other than the one pinned by `hf init`, to a plain file, or to the agent's environment.
- Prompts, responses, tool inputs or outputs, or file contents being sent anywhere.
- A repository's `.claude/settings.json` or other untrusted input changing where keys are sent, or
  making `hf` or the plugin hook run unintended commands.
