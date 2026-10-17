---
"@harnessforce/cli": patch
---

`harnessforce tune` now restarts without the TLS and proxy runtime variables (`NODE_TLS_REJECT_UNAUTHORIZED`, `NODE_OPTIONS`, `HTTPS_PROXY`, and the others) before it sends analysis results, as the other commands that send keys or tokens already do. `harnessforce tune` also writes MCP server names and model names to the terminal as printable ASCII only: the text output shows other characters as `\u{..}`, and `--json` and `--show-report` write them as JSON `\u` escapes, so the values parse the same.
