---
"@harnessforce/cli": minor
"@harnessforce/semconv": minor
---

`harnessforce import` が `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` から Codex の過去のsessionも取り込む。本文は読んでも送らず、`failures` は省略する。session import の `tool_calls[].failures` は Codex の要素で省略できる。
