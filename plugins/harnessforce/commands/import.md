---
description: Import your past sessions on this machine into Harnessforce and report how many were imported and why others were skipped
disable-model-invocation: true
---

# Import past sessions

`harnessforce import` sends a summary of each past session of the repositories connected to your Workspace, inside the import window. It sends no prompt text, responses, tool inputs or results, or code. It is safe to run again, because sessions that were already sent are skipped.

Run it:

```sh
harnessforce import
```

- If the command is not found, tell the user to run `/harnessforce:setup` and stop.
- If it reports that you are not logged in, tell the user to run `/harnessforce:setup` (it runs `harnessforce init`, which needs a browser) and stop.
- Show the imported count and the breakdown of skipped sessions with the next action, exactly as printed. Do not leave out the reason when nothing was imported.
