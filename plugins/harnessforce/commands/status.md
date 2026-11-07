---
description: Show whether this machine is connected to Harnessforce, the setup steps that remain, and the running and recent agent sessions on this machine
disable-model-invocation: true
---

# Harnessforce status

This command only reads. It changes no file, setting or Workspace data. It sends read requests to Harnessforce and nothing else.

## 1. Read the connection status

Run this once:

```sh
harnessforce status
```

If the command is not found, tell the user to run `/harnessforce:setup` and stop.

Show its output to the user as is: the Workspace and your role, each setup step (done, to do with its URL, or `?` when it cannot be read), whether this repository is assigned to a project, and any agent that is older than the Harnessforce hooks support. If it fails, show its output as is and continue with step 2: the sessions on this machine can be read without a connection.

## 2. Take a snapshot of the sessions

Run this once. It prints one snapshot as JSON and exits, so it does not open the interactive view.

```sh
harnessforce top --once --json
```

If it fails, show its output as is and stop.

Summarize the snapshot for the user in a few lines: how many sessions are running, which agent and repository each belongs to, and any recent sessions that ended. Report only values that are in the JSON. Do not guess a value that is missing, and do not turn a missing value into 0.

## 3. Point to the live view

The interactive view needs a terminal, so this command does not start it. Tell the user to run `harnessforce top` in a terminal when they want the live view.
