---
"@harnessforce/cli": patch
---

`hf import` now resolves its destinations the same way as `hf run`: an empty value in the Claude Code user settings counts as absent, and a keychain whose availability cannot be checked is reported as unavailable.
