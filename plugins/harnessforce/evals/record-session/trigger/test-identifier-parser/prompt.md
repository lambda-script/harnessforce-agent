---
description: The record-session skill is not invoked
tags: [trigger]
max_turns: 3
allowed_tools: [Read, Glob, Grep, Skill]
append_system_prompt: "harnessforce agent_session_id: eval-session-1"
---

Write a unit test for a function that parses issue identifiers such as ENG-42 and acme/tool#57.
