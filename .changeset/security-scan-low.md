---
"@harnessforce/cli": patch
"@harnessforce/claude-code-plugin": patch
---

`harnessforce status` no longer prints terminal control characters or characters that change the text direction from the Workspace name and the setup step links, and `harnessforce run` drops the direction characters from issue titles too. Collecting the configuration now stops reading a file after 1 MiB even when the file reports a size of 0, so a repository that links `CLAUDE.md` to a Linux `/proc` file can no longer make `harnessforce run` or the hooks read without end. The diagram skill's render script no longer starts mermaid-cli on Windows, as its compatibility line already said.
