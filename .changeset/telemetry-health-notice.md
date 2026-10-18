---
"@harnessforce/cli": minor
"@harnessforce/claude-code-plugin": minor
---

When telemetry cannot be sent, the session now says why in one line at its start, with the fix: no ingest key in the keychain, a keychain that could not be read, a destination that differs from the one `harnessforce init` saved, or missing Claude Code telemetry settings. Codex shows its warnings in its UI through `systemMessage` instead of plain text. `harnessforce otel-headers` exits 3 when there is no key and 4 when it withholds the key, and on Linux moves a key kept in the kernel keyring to an unlocked Secret Service so a reboot no longer loses it.
