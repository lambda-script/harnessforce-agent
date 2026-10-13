---
description: Show the running and recent agent sessions on this machine as a short summary, using a read-only snapshot of harnessforce top
disable-model-invocation: true
---

# Session status

This command only reads. It changes no file, setting or Workspace data, and sends nothing to Harnessforce.

## 1. Take a snapshot

Run this once. It prints one snapshot as JSON and exits, so it does not open the interactive view.

```sh
harnessforce top --once --json
```

If the command is not found, tell the user to run `/harnessforce:setup` and stop. If it fails, show its output as is and stop.

## 2. Summarize

Summarize the snapshot for the user in a few lines: how many sessions are running, which agent and repository each belongs to, and any recent sessions that ended. Report only values that are in the JSON. Do not guess a value that is missing, and do not turn a missing value into 0.

## 3. Point to the live view

The interactive view needs a terminal, so this command does not start it. Tell the user to run `harnessforce top` in a terminal when they want the live view.
