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
| `/harnessforce:status` | Shows whether this machine is connected, the setup steps that remain, and the sessions on this machine (read-only). |
| `/harnessforce:import` | Imports past sessions. |
| `/harnessforce:tune` | Analyzes your past sessions and proposes improvements. |

## Not wrapped

- `harnessforce init` opens a browser to log in and takes up to 5 minutes, so it is not wrapped as its own command. `/harnessforce:setup` runs it for you.
- `harnessforce top` without `--once` is an interactive view that needs a terminal. Run it in a terminal.
- `harnessforce run --issue <identifier> -- claude` starts an agent on an Issue as a new process, so a session cannot run it. Run it in a terminal; everything after `--` is passed to the agent unchanged (use `codex` instead of `claude` for Codex). It sets `HARNESSFORCE_ISSUE`, which ties the new session to the Issue. A running session cannot be tied to an Issue afterwards.
- `harnessforce otel-headers` and `harnessforce hook` are run by the agents, not by you.
