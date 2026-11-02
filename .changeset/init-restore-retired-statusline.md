---
"@harnessforce/cli": patch
---

`harnessforce init` now repairs the Claude Code status line left by the retired `harnessforce usage-limits` command. When the user settings' `statusLine.command` starts with `harnessforce usage-limits`, it backs up the settings file (mode 0600), restores the status line recorded in `~/.harnessforce/usage-limits.json`, or removes it when nothing was recorded, and prints one line saying what it did. It then removes the leftover `usage-limits.json` and `usage-limits-state.json`. Other status lines are not touched.
