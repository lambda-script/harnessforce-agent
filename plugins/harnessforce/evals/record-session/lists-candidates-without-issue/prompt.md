---
description: For work that commits changes without an Issue, existing Issues are offered through list_issues with the documented q and sort, and no Session is registered before the user picks one (regression of issue 112)
tags: [rules]
max_turns: 8
allowed_tools: [Read, Glob, Grep, Skill]
append_system_prompt: "harnessforce agent_session_id: eval-session-1\nFor work that commits changes when no Issue is specified, follow \"When no Issue is specified\" in the Harnessforce record-session skill."
---

Rename the --quiet flag of the export command to --silent and commit the change.
