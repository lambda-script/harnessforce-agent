---
"@harnessforce/cli": patch
---

`harnessforce init --url` no longer appears in the usual `--help` output, because customers only connect to the default Harnessforce service. The option still works when given. When `init` connects somewhere other than the default, it now prints the destination so you can notice it.
