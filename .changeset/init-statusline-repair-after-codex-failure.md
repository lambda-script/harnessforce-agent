---
"@harnessforce/cli": patch
---

`harnessforce init` now prints the line about the repaired Claude Code status line, and removes the leftover `usage-limits.json` and `usage-limits-state.json`, as soon as the user settings are written. Before, a failure to write the Codex `config.toml` hid the line and kept the files, even though the status line had already been changed.
