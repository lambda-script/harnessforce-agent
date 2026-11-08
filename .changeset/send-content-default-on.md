---
"@harnessforce/cli": patch
"@harnessforce/claude-code-plugin": patch
---

A machine that never chose whether to send content now sends it. When `~/.harnessforce/config.json` is missing or has no `send_content` key, `harnessforce login` writes the content variables as `1` for the categories the Workspace stores, and `harnessforce config get send-content` prints `on`. Run `harnessforce config set send-content off` to stop; `harnessforce login` keeps that choice. A file that cannot be read, is not a JSON object, or has a `send_content` that is not a boolean still means off. The message after content is turned on now ends with how to stop, and `harnessforce login` adds the managed settings line when the organization's managed settings also set the content variables. The plugin's setup, help and injected introduction say that content is sent by default.
