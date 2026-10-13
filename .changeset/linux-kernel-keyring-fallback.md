---
"@harnessforce/cli": patch
---

`harnessforce init` on Linux now saves to the kernel keyring when the Secret Service cannot be used (for example over SSH or with a locked KWallet), waits at most 60 seconds for an unlock prompt, and names both stores when neither works.
