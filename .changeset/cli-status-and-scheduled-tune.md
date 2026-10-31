---
"@harnessforce/cli": minor
---

Add `harnessforce status [--json]`, which shows the connected Workspace, your role, the setup steps that remain with their URLs, and whether the `origin` repository of the current directory is connected to the GitHub App. It only reads, and the remote URL is compared on this machine and never sent. Add `harnessforce tune --report-only [--all]`, which analyzes and sends without writing to stdout, and `harnessforce tune --print-schedule`, which prints a cron line that runs it every Monday at 9:00 local time. Harnessforce never registers the line itself.
