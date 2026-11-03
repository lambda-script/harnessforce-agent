---
"@harnessforce/cli": minor
"@harnessforce/claude-code-plugin": patch
---

The Codex `SessionStart` hook now warns "Codex is sending telemetry to Harnessforce every second. Start Codex with `harnessforce run -- codex` to send it every minute" when the `[otel]` exporter in Codex's `config.toml` sends to Harnessforce and `OTEL_BLRP_SCHEDULE_DELAY` is missing or not an integer of at least 60000, that is, when Codex was started without `harnessforce run`. Registration is still sent. The `Stop` hooks of Codex and Claude Code no longer read the ingest key (Claude Code starts `harnessforce otel-headers` for it) in a turn whose repository and branch pairs are the ones already sent.
