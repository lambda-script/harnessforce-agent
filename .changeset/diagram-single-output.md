---
"@harnessforce/claude-code-plugin": patch
---

The diagram skill delivers one file per diagram. `render.mjs` without a delivery option writes the light and dark PNGs it looks at into `~/.cache/harnessforce-diagram/renders/` instead of next to the diagram. `--portable`, `--png` and `--svg` each write one file (a PNG or SVG in the light theme, `--theme dark` for a dark one), and the portable Markdown carries the `.mmd` after the block, which `render.mjs --source` writes back out, so a repository no longer keeps the `.mmd` or a light and dark pair of SVGs.
