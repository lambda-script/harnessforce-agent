---
"@harnessforce/cli": patch
---

`harnessforce import` now says that sessions were not imported because their repository is not assigned to a project, since Harnessforce stores only sessions of repositories that are connected to the GitHub App and assigned to a project. When nothing was imported for that reason, it asks you to connect the repository to the GitHub App and assign it to a project.
