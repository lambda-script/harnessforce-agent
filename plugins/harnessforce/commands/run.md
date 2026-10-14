---
description: Explain how to start an agent on a Harnessforce Issue with harnessforce run, because a session cannot start its own agent
argument-hint: "<issue-identifier>"
disable-model-invocation: true
---

# Run an agent on an Issue

`harnessforce run` starts an agent for an Issue. It has to start that agent as a new process in a terminal, so this command cannot do it from inside a session. It runs nothing. It only shows the steps.

Take the Issue identifier from `$ARGUMENTS` (for example `ABC-123`). If it is empty, ask the user for it.

## Start the agent in a terminal

Tell the user to run this in a terminal, outside this session. Replace `claude` with the agent to start (for example `codex`).

```text
harnessforce run --issue <identifier> -- claude
```

Everything after `--` is passed to the agent unchanged. The agent's exit code becomes the exit code of `harnessforce run`. It needs `harnessforce init` to have been done; if not, run `/harnessforce:setup` first.

## Already in a session?

The plugin's hooks tie a session to an Issue when the environment variable `HARNESSFORCE_ISSUE` is set to the identifier before the agent starts. `harnessforce run` sets it for you. This session was started without it unless the user set it, and an environment variable cannot be added to a running session. To work on the Issue, start a new session as above.
