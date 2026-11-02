---
"@harnessforce/claude-code-plugin": patch
---

The `record-run` skill now searches candidate Issues with `-status:resolved,not_planned <word>`. The previous `-status:done,canceled` used statuses that Issues no longer have, so `list_issues` rejected the query and no candidate was shown. The skill also says that the first MCP login chooses a Workspace and a Project.
