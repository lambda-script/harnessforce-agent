---
"@harnessforce/claude-code-plugin": patch
---

`/harnessforce:insights` now finds `harnessforce` the same way the hooks do: it looks only in the absolute directories of `PATH`, skips the current directory and the repository it is in, and starts the npm `.cmd` shim on Windows with Node.js instead of `cmd.exe`. Before, a `harnessforce.cmd` (or `.bat`, `.exe`) placed in the opened repository could run in place of the CLI on Windows.
