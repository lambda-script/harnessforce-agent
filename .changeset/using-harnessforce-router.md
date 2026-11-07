---
"@harnessforce/claude-code-plugin": minor
"@harnessforce/cli": patch
---

The introduction that the Harnessforce hook adds to every Claude Code and Codex session now tells the agent which Harnessforce skill to use for which request (including the `diagram` skill), lists every hook with what it sends (it had left out the usage summary sent at session end), says that Codex telemetry carries tool arguments and results, and names more of the mistakes to stop at.
