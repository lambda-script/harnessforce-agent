---
"@harnessforce/cli": patch
---

`harnessforce status` now says whether the repository of the current directory is assigned to a project, and the `harnessforce tune` messages about which sessions are not sent now name the repositories assigned to a project, instead of "connected". The `/harnessforce:setup` command tells you to connect the repository to the GitHub App and assign it to a project when its sessions were not imported.
