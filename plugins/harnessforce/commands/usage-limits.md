---
description: Show whether your Claude Code usage limits are shared with your Workspace; turning sharing on or off is left to you
disable-model-invocation: true
---

# Usage limits sharing

This command only reads the current state. It never turns sharing on or off.

## 1. Show the state

```sh
harnessforce usage-limits status
```

If the command is not found, tell the user to run `/harnessforce:setup` and stop. Show the output as is. Do not rephrase the Workspace opt-in state: "enabled", "disabled" and "cannot be confirmed" mean different things.

## 2. Explain how to change it

Sharing sends only the usage percentage and reset time of each window (such as 5 hours and 7 days) with your name. It sends no prompt or other content. It is off by default. The user changes it, because the command asks for their own consent:

- To share, tell the user to type `!harnessforce usage-limits on` in this session and answer the consent prompt themselves. Never add `--yes` and never answer for them.
- To stop, tell the user to type `!harnessforce usage-limits off`. Stopping deletes the stored values.
