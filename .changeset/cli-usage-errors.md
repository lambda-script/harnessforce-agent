---
"@harnessforce/cli": minor
"@harnessforce/claude-code-plugin": minor
---

`harnessforce` now answers a bad argument with what is wrong and the usage of that command, and exits 2 (`otel-headers` and `hook` still exit 1). An unknown command suggests the closest one (`harnessforce stauts` → `Did you mean "status"?`), and `harnessforce` with no command prints the overview help. `harnessforce --help` lists the commands your agents run (`otel-headers`, `hook`, `tune record`) apart from yours. `harnessforce top --once` no longer prints the key hints of the live view. `harnessforce status` names each of `claude` and `codex` that is older than the oldest version the Harnessforce hooks support, and `--json` adds `outdated_agents`. `/harnessforce:status` now shows the connection status from `harnessforce status` before the sessions on this machine, and `/harnessforce:run` is removed: `/harnessforce:help` explains running `harnessforce run` in a terminal.
