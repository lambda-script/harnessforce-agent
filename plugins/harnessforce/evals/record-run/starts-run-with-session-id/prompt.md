---
description: With the session ID in the context, the Run is registered with that ID and without the repository, branch, or commit
tags: [rules]
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
append_system_prompt: "harnessforce session_id: eval-session-1"
---

Work on the Harnessforce issue ENG-42: add a --verbose flag to the export command. Record the run first, then tell me what the issue asks for before you change any code.
