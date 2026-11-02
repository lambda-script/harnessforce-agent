---
"@harnessforce/cli": minor
---

`harnessforce init` now writes `OTEL_LOGS_EXPORT_INTERVAL`, `OTEL_TRACES_EXPORT_INTERVAL` and `OTEL_METRIC_EXPORT_INTERVAL` as `60000` in the Claude Code user settings, replacing values already there, so Claude Code sends logs and traces once a minute instead of every 5 seconds. Events reach Harnessforce up to a minute later. What is not sent within the exit wait (2 seconds for Claude Code, 500 ms for Codex) can be lost, and so can the last minute when the agent stops without exiting normally. `harnessforce run -- codex` now sets `OTEL_BLRP_SCHEDULE_DELAY=60000` for Codex, replacing the shell's value, so Codex sends logs once a minute instead of every second. A Codex started without `harnessforce run` keeps its default or the shell's value. Codex's `config.toml` is not changed, because it has no key for the interval.
