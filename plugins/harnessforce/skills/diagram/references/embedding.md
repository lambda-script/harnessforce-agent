# Putting a diagram on a page

What each output of `render.mjs` shows where, as observed on 2026-11-07. Pages change their Mermaid version and their rules; when a page draws a diagram differently from this table, check it again with a ```` ```mermaid info ```` block, which prints the page's Mermaid version.

## Contents

- [Outputs](#outputs)
- [What each page shows](#what-each-page-shows)
- [Rules for the portable block](#rules-for-the-portable-block)

## Outputs

| File | Made by | Holds |
| --- | --- | --- |
| `<name>.png`, `<name>.dark.png` | `render.mjs` | The picture at scale 2. For looking at in step 5, and for places that take only an uploaded image |
| `<name>.svg`, `<name>.dark.svg` | `render.mjs --svg` | The same picture as vectors, with the logos inside as data URIs. No font is embedded: the labels are measured in Arial's widths, which Windows, macOS and most Linux desktops draw, and a viewer with a wider font (Android) draws each label whole, slightly past its box, instead of cutting it off |
| `<name>.portable.md` | `render.mjs --portable` | One ```` ```mermaid ```` block: the `.mmd` with each logo inline as a data URI on its tile, the label rules in the frontmatter `themeCSS` and the labels' font in `fontFamily`, unless the diagram sets its own. The page draws it with its own Mermaid |

## What each page shows

| Page | SVG as an image | Portable block |
| --- | --- | --- |
| GitHub Markdown (Mermaid 12.2.0) | As rendered; light and dark with `#gh-light-mode-only` / `#gh-dark-mode-only` | Node logos, colors and layout as rendered (ELK is v12's default). GitHub removes an `<img>` from a group title, so the block draws group-title logos through its CSS, which GitHub keeps, together with the move of each title to its group's top left. It removes `<small>` too, which the block therefore writes as `<span style=font-size:smaller>`. The light colors stay in dark mode. When the viewer's color scheme is dark, the block inverts the labels that stand on the page (edge labels, names under logos), so they read light without a white box; labels on a filled group, which stays light, are left as they are. Other diagram types keep their light theme on the dark page |
| mermaid.live | — | Everything, group-title logos included |
| GitLab, VS Code preview, Obsidian, Notion | Not checked | Not checked |

A node whose `img` is a URL instead of a data URI breaks the diagram on GitHub: its Content Security Policy blocks the image and the page shows "Unable to render rich display" instead of the diagram. Always write `icon:<spec>` and let `render.mjs` inline it.

## Rules for the portable block

- Mermaid refuses a source longer than 50,000 characters (`maxTextSize`, which a page sets and a diagram cannot raise). Logos make up most of the length: about 1 to 9 KB each once inlined. `render.mjs --portable` refuses a longer block; split the diagram (SKILL.md step 1) rather than drop logos.
- The block names the font the labels were measured in. Without it the page's default font (on GitHub, `"trebuchet ms", verdana, arial`, which falls back to a wider font on Linux) wraps a name that fits in Arial onto a line its box cuts off.
- The block has no dark version: GitHub keeps the diagram's `theme:` in dark mode, and the diagram's own background cannot be set (GitHub scopes every `themeCSS` rule, `&` included, to the diagram's descendants). Its CSS sees the viewer's color scheme (`prefers-color-scheme`), not GitHub's own theme setting, so a reader whose GitHub theme differs from their system's sees the other variant of the labels. Prefer the SVG pair where the reader may use dark mode.
- Edit the `.mmd`, not the block, and run `render.mjs --portable` again: the block's logos are unreadable base64.
