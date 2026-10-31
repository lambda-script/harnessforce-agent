---
"@harnessforce/claude-code-plugin": patch
"@harnessforce/cli": patch
---

`/harnessforce:setup` can now be started by the agent when you ask it to set up Harnessforce, ends only with the defined last lines (including where it stopped), shows the remaining workspace steps from `harnessforce status --json`, keeps going when the import fails, explains an `EACCES` npm install failure, updates an unsupported CLI, and asks Codex users to trust the `SessionStart`, `PostToolUse` and `Stop` hooks in `/hooks`. The `record-run` skill no longer passes the repository, branch or commit to `start_run`, and offers once to link committing work without an Issue to an existing Issue. `harnessforce otel-headers --help` lists the exit codes 3, 4, 5 and 1, and `harnessforce import --help` says that only Codex sessions send the commit.
