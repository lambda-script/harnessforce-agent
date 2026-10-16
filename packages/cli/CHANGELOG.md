# @harnessforce/cli

## 0.2.0

### Minor Changes

- a037024: Make all user-facing text English only: the CLI output, the hook warnings, the loopback page, and the plugin commands, skills, and docs. The consent text of `harnessforce usage-limits on` no longer switches to Japanese by locale.
- 67f9a81: `harnessforce --help` now lists every command with a one-line description, and `harnessforce <command> --help` explains when to use it, what it does, what it sends and does not send, its exit codes, and examples.

### Patch Changes

- d51b667: `harnessforce init --url` no longer appears in the usual `--help` output, because customers only connect to the default Harnessforce service. The option still works when given. When `init` connects somewhere other than the default, it now prints the destination so you can notice it.
- 337b7e6: `harnessforce import` now says why sessions were not imported: it counts them as already sent, outside the import window, outside a git repository, or in a repository not connected to the Workspace, and asks you to connect the repository with the GitHub App when that left nothing to import.

## 0.1.1

### Patch Changes

- 9fec25a: `harnessforce init` on Linux now saves to the kernel keyring when the Secret Service cannot be used (for example over SSH or with a locked KWallet), waits at most 60 seconds for an unlock prompt, and names both stores when neither works.
