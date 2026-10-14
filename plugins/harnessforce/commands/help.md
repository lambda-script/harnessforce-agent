---
description: List the harnessforce CLI commands and the /harnessforce:* commands, and say which one to use for what
disable-model-invocation: true
---

# Harnessforce help

Show the user this guide. To list the CLI commands with a one-line description each, run:

```sh
harnessforce --help
```

If the command is not found, tell the user to run `/harnessforce:setup`. `harnessforce <command> --help` shows what a command does, what it sends and does not send, and its exit codes.

## Commands in a session

| Command | What it does |
| --- | --- |
| `/harnessforce:setup` | Installs the CLI, connects to Harnessforce with `harnessforce init`, imports past sessions and confirms the first event. |
| `/harnessforce:status` | Summarizes the sessions on this machine (read-only). |
| `/harnessforce:import` | Imports past sessions. |
| `/harnessforce:usage-limits` | Shows whether usage limits are shared. |
| `/harnessforce:tune` | Analyzes your past sessions and proposes improvements. |
| `/harnessforce:run <issue>` | Shows how to start an agent on an Issue. |

## Not wrapped

- `harnessforce init` opens a browser to log in and takes up to 5 minutes, so it is not wrapped as its own command. `/harnessforce:setup` runs it for you.
- `harnessforce top` without `--once` is an interactive view that needs a terminal. Run it in a terminal.
- `harnessforce run` starts an agent as a new process. See `/harnessforce:run`.
- `harnessforce otel-headers` and `harnessforce hook` are run by the agents, not by you.
