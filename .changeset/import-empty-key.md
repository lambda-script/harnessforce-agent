---
"@harnessforce/cli": patch
---

`hf import` treats an empty user ingest key in the keychain as missing, like `hf run`, and asks to run `hf init` instead of sending it.
