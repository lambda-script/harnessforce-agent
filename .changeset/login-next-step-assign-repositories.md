---
"@harnessforce/cli": patch
---

`harnessforce login` now ends by pointing at the page that assigns repositories to a project while the Workspace has none assigned, instead of suggesting `harnessforce import`, which imports nothing until a repository is assigned.
