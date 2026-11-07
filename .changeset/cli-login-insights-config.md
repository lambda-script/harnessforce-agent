---
"@harnessforce/cli": minor
"@harnessforce/claude-code-plugin": minor
---

The CLI commands now use the common names. `harnessforce init` is `harnessforce login`, and `harnessforce tune` is `harnessforce insights` (`--report-only` is `--quiet`, `--print-schedule` is `insights schedule`, `--purge` is `insights clear`, and `tune record` is `insights record`). It keeps its files in `~/.harnessforce/insights/` and reads `insights.send_report`; the old `tune` files and setting are not read. The old names are removed. `harnessforce logout` revokes this machine's ingest key and login and removes the settings `login` wrote. Whether this machine sends prompts and responses is now `harnessforce config set send-content on|off` instead of `login --send-content`, and logging in again keeps that choice. `harnessforce login` says what it waits for and how to cancel before opening the browser, exits 130 on Ctrl+C, and ends with the next command to run. Not being logged in and a changed destination now have their own messages. `/harnessforce:tune` is `/harnessforce:insights`, and the plugin needs CLI 0.7.0.
