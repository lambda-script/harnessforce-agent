---
"@harnessforce/cli": patch
---

`harnessforce import` now says why sessions were not imported: it counts them as already sent, outside the import window, outside a git repository, or in a repository not connected to the Workspace, and asks you to connect the repository with the GitHub App when that left nothing to import.
