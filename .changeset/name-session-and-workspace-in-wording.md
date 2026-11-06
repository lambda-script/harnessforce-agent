---
"@harnessforce/cli": patch
"@harnessforce/claude-code-plugin": patch
---

Name the session and the Workspace in the messages people see. `harnessforce status` and `/harnessforce:setup` title step 5 "Wait for your first session", the hooks say "The Workspace's ingest key has been revoked" for a revoked Workspace key, and `harnessforce init --help` says that the Codex `config.toml` holds the user ingest key in plain text.
