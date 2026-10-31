---
"@harnessforce/cli": patch
---

Hooks and `harnessforce otel-headers` no longer ask a locked Secret Service for an unlock. On KDE, those requests piled up behind an unanswered KWallet window and kept the unlock window of `harnessforce init` from appearing. While `harnessforce init` waits for KWallet, it now says which window asks for the password and what to do when none appears.
