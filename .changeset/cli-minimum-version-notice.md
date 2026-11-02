---
"@harnessforce/claude-code-plugin": minor
---

Show one line when the installed CLI is older than the plugin needs (CLI 0.4.0 or later). At a session start that registers, the hook runs `harnessforce --version` (up to 1 second) and shows "Harnessforce plugin needs CLI 0.4.0 or later, but CLI <version> is installed. Update it: `npm install -g @harnessforce/cli@latest`" at every start, even with `NO_UPDATE_NOTIFIER` or `CI` set. `/harnessforce:setup` does the same check in step 3, and before step 9 after the restart, and stops at step 3 with the same line. Neither updates the CLI, and sending does not stop. The local marketplace build, which installs the CLI from the same build, does not check.
