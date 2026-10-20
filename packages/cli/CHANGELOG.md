# @harnessforce/cli

## 0.2.0

### Minor Changes

- f440693: Declare the client version on requests to Harnessforce and act on the update status the server returns. A newer version, an upcoming deadline after a security fix, or an unsupported version is shown in one line with the command to update. While a version is unsupported, the CLI and the hooks stop sending to Harnessforce without stopping the agent session, and check again without credentials after 24 hours. `harnessforce init` turns on automatic updates for the Harnessforce plugin marketplace in Claude Code; `harnessforce init --no-plugin-auto-update` turns them off.
- a037024: Make all user-facing text English only: the CLI output, the hook warnings, the loopback page, and the plugin commands, skills, and docs. The consent text of `harnessforce usage-limits on` no longer switches to Japanese by locale.
- 67f9a81: `harnessforce --help` now lists every command with a one-line description, and `harnessforce <command> --help` explains when to use it, what it does, what it sends and does not send, its exit codes, and examples.
- 3079a53: When telemetry cannot be sent, the session now says why in one line at its start, with the fix: no ingest key in the keychain, a keychain that could not be read, a destination that differs from the one `harnessforce init` saved, or missing Claude Code telemetry settings. Codex shows its warnings in its UI through `systemMessage` instead of plain text. `harnessforce otel-headers` exits 3 when there is no key and 4 when it withholds the key, and on Linux moves a key kept in the kernel keyring to an unlocked Secret Service so a reboot no longer loses it.

### Patch Changes

- d51b667: `harnessforce init --url` no longer appears in the usual `--help` output, because customers only connect to the default Harnessforce service. The option still works when given. When `init` connects somewhere other than the default, it now prints the destination so you can notice it.
- 337b7e6: `harnessforce import` now says why sessions were not imported: it counts them as already sent, outside the import window, outside a git repository, or in a repository not connected to the Workspace, and asks you to connect the repository with the GitHub App when that left nothing to import.
- 33bcd76: Leave the values that can carry credentials out of the hook and MCP server hashes in the config snapshot: `env` and `headers` values, `args`, and the userinfo, query and fragment of URLs. `harnessforce tune record` hashes hook and MCP server proposals the same way. Hook and MCP server versions change once after the update.
- 658c8f1: `harnessforce tune` now restarts without the TLS and proxy runtime variables (`NODE_TLS_REJECT_UNAUTHORIZED`, `NODE_OPTIONS`, `HTTPS_PROXY`, and the others) before it sends analysis results, as the other commands that send keys or tokens already do. `harnessforce tune` also writes MCP server names and model names to the terminal as printable ASCII only: the text output shows other characters as `\u{..}`, and `--json` and `--show-report` write them as JSON `\u` escapes, so the values parse the same.

## 0.1.1

### Patch Changes

- 9fec25a: `harnessforce init` on Linux now saves to the kernel keyring when the Secret Service cannot be used (for example over SSH or with a locked KWallet), waits at most 60 seconds for an unlock prompt, and names both stores when neither works.
