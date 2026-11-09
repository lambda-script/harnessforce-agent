---
name: diagram
description: Experimental. Draws diagrams of a software project from its repository or from a description of the system: architecture and infrastructure diagrams with product logos and AWS, Google Cloud and Azure service icons, CI/CD pipelines, state machines, error-handling flows, ER diagrams, Gantt charts of issues and PRs, and request sequences. Reads IaC, workflows, schemas, specs and issue/PR history, writes Mermaid, checks the picture against the sources, and delivers one file per diagram. Needs the network: mermaid-cli and Chromium are downloaded on first use, and logos are fetched from icon sites (svgl, devicon, gilbarbara/logos, Lucide), which see the products asked for. Use when the user asks for an architecture, system, infra, stack, CI/CD, pipeline, state, lifecycle, error-flow, ER, schema, timeline, roadmap or Gantt diagram, of a repository or a described system, or asks whether an existing diagram still matches the code, even if Mermaid is not mentioned; not for explaining code without a diagram.
compatibility: Node.js 18+ on macOS or Linux (the render script does not start mermaid-cli on Windows). mermaid-cli 12.2.0 (npx, or $MMDC) with Chromium for rendering; both are downloaded on first use (about 1.4 GB in the npm and Puppeteer caches), which fails without network access. Network access to fetch logos and the cloud providers' icon packages.
---

# diagram

Turns a repository into diagrams a person understands at a glance. The Mermaid text is the editable source, and each diagram is delivered as one file that carries it. Every element is drawn from a file in the repository, so the diagram can be checked against the sources instead of trusted.

## Workflow

Paths below are relative to this skill's directory.

Copy this checklist and tick it off:

```text
- [ ] 1. Pick the diagram type and scope
- [ ] 2. Read the sources and list nodes, groups and edges with their file:line
- [ ] 3. Fetch logos (every type that draws HTML)
- [ ] 4. Write the Mermaid
- [ ] 5. Render and look at the PNG; fix and re-render until clean
- [ ] 6. Check the picture against the sources
- [ ] 7. Deliver
```

### 1. Pick the diagram type and scope

| The user wants to see | Mermaid | Read |
| --- | --- | --- |
| Services, runtimes, data stores, external SaaS and how requests flow | `flowchart LR` with logos | [references/architecture.md](references/architecture.md) |
| CI jobs, their order, conditions and deploy targets | `flowchart LR` with logos | [references/cicd.md](references/cicd.md) |
| The states of one entity and what moves it between them | `stateDiagram-v2` | [references/state.md](references/state.md) |
| What happens when something fails: retries, dead letters, user-facing errors | `flowchart TD` or `sequenceDiagram` | [references/error-flow.md](references/error-flow.md) |
| Tables, columns and relations | `erDiagram` | [references/erd.md](references/erd.md) |
| Work over time from issues, PRs, milestones | `gantt` | [references/gantt.md](references/gantt.md) |
| One request or job across components, in order | `sequenceDiagram` | [references/sequence.md](references/sequence.md) |

Scope one diagram to one environment (for example production) and one question. Diagrams with few elements read best: keep one to about 10 nodes and 12 edges, and when it needs more, split it rather than shrink it. Draw an architecture in layers, as C4 goes from context to containers: first an overview with one node per layer (clients, each platform, the data stores, the external services), nothing inside them and only the main flows between them; then one diagram per layer, titled with that node's name, so a reader can find each detail diagram from the overview.

### 2. Read the sources

Read the sources as they are now: fetch the repository and read the default branch's head (`git fetch` and `git show origin/main:<path>`, or pull a clean checkout) right before drawing, and again before delivering. CI rules and specs change daily, and a diagram drawn from a checkout a day old showed a merge gate that had been removed that afternoon. Write the commit you read in the `%%` source comment. Read the files the reference for the type lists. Write down each node, group and edge with the file and line it came from. Facts come from committed files; when a doc and a config disagree, draw neither side's claim as settled, note it, and report it in step 6.

When there is no repository and the user describes the system in prose ("a user reaches Next.js on Vercel over HTTPS; Next.js queries Neon over SQL"), the description is the source. Each clause gives a node, an edge and its label; vendors and runtimes it names give the groups, and a product it names alone (Neon, Stripe) stands without a group, since a "Data stores" or "External services" box it never mentions is an invention. Draw only what it says, put the description in a `%%` comment right below the diagram type line (a frontmatter must stay on the first line) instead of `file:line` comments, and in step 6 list everything you inferred (a role line, a public/private subnet split, which edge is primary).

Never put secret values, environment variable values, connection strings or account IDs in a diagram.

### 3. Choose logos (architecture, CI/CD, error flows, states and ER diagrams)

Name each node's logo in the Mermaid as `img: "icon:<spec>"`: `icon:neon`, `icon:workers:cloudflare-workers`, `icon:queue:lucide/list-ordered`. `render.mjs` fetches missing logos into a cache outside the repository and embeds them, so logos are never committed. To check a spec before writing it:

```sh
node scripts/fetch-icons.mjs vercel neon workers:cloudflare-workers queue:lucide/list-ordered
```

State names and ER entity titles take a logo or a Lucide glyph too, through `<img src='icon:<spec>'>` (state.md, erd.md); sequence diagrams and Gantt charts cannot, and take the palette instead (sequence.md, gantt.md). Concepts without a brand (a browser, a user, a server) take a Lucide icon such as `browser:lucide/app-window`. Rules for choosing and never altering logos: [references/icons.md](references/icons.md). AWS, Google Cloud and Azure services use the providers' own icons, groups and full names: [references/cloud-providers.md](references/cloud-providers.md).

### 4. Write the Mermaid

Start from the template and rules in [references/mermaid-layout.md](references/mermaid-layout.md). The ones that matter most:

- `layout: elk` with `forceNodeModelOrder: true` and `mergeEdges: true` (edges meet the tiles, not the names), `theme: neutral`; also try `nodePlacementAlignment: RIGHTDOWN` and keep the more compact render.
- Keep each diagram to about 10 nodes and 12 edges (step 1). When two layers both call two others, the four edges cross once in any order: leave one of them to the detail diagram (rule 46).
- Declare the secondary calls first and the primary flow last, so the primary color paints the segments merged edges share (rule 36). Edges that point back close cycles and move groups (rule 11); a call back between two nodes of the main flow is a label-directed line (rule 34).
- Three edge styles via `linkStyle`: primary (blue, thick), secondary (gray), deploy (gray, dashed), each with `color:` set to its stroke so the label takes the edge's color; a diagram of outcomes adds failure (red) and waiting (orange). Deploy and IaC edges go in a separate diagram. Explain the colors once in the Markdown, not in a legend inside the diagram (rule 52).
- Group titles carry the vendor's mark: `subgraph vercel["<img src='icon:vercel' width='26' height='26' style='vertical-align:middle'/> <b>Vercel</b>"]` (rule 44). A small diagram (about ten nodes) uses `nodeSpacing: 30`, `rankSpacing: 50` and a `wrappingWidth` just above its longest label (rule 43).
- Logo nodes as `id@{ img: "icon:<name>", label: "<b>Name</b><br/><small>role</small>", pos: "b", w: 72, h: 72, constraint: "on" }` with the `tile` class (`fill:none,stroke:none`, `font-size:18px`); `render.mjs` draws the white tile.
- Draw every edge as a real arrow the way the data goes: when Inngest pulls Notion's docs, `notion -->|docs| inngest`. When two groups share a column or a call against the flow drags groups around, use the column rules (23–26): a `~~~` hint between groups, and only after a render shows the arrow moving groups, a label-directed line (`a ---|"◀ webhooks"| b`) for that call. In a small diagram the glyph reads as a stray arrowhead in the middle of the line.

Put a `%% <path>:<line>` comment above each node or group of edges, so a reviewer can find the source. Labels default to English; use the language of the target repository's docs when the user asks for it.

Write it to `<name>.mmd` in a scratch directory outside the repository: the delivered file carries the `.mmd` (step 7), so the repository never holds it. To change a delivered diagram, start from its source: `node scripts/render.mjs --source <file.md>` writes the `<name>.mmd` of each diagram the file carries into a cache directory and prints the paths.

### 5. Render and look

```sh
node scripts/render.mjs <diagram.mmd>...
```

This puts each `icon:<spec>` logo (fetched if needed) on a white tile and embeds the tile as a data URI and writes `<diagram>.png` and `<diagram>.dark.png` at the diagram's natural width (mermaid-cli would otherwise shrink anything wider than about 800 px) into a cache directory outside the repository, and prints their paths. For a flowchart, state or ER diagram it also prints how many times edges cross and which (`a → c + b → c × d → e`: merged edges on one line, crossed by another). Count crossings from this line, not by eye: an agent looking at a PNG reported one crossing where there were two. Run it with `--help` for the options. Then open both PNGs and check:

- No arrow crosses a label; labels and logos are readable in both themes.
- The primary flow reads left to right as one path; groups are not scattered; no line crosses the whole diagram or runs around a group (if one does, split the diagram as in step 1, or try node declaration orders, rule 37).
- The crossing count is as low as the declaration orders allow: when it is above 0, try the orders of rule 55 and keep the render with the fewest crossings that still reads left to right.
- The PNG is at most about three times wider than tall (or taller than wide). People see it at page width, where a 5:1 strip of eleven nodes shrank its names to a few pixels. Fold a long row (rule 49, or `flowchart TD`) or split the diagram.
- Dashed edges are dashed everywhere (set `lineHops: false` if not).
- Every picture you deliver is whole: once a light render came out as one tile and one edge repeated across the image while its dark render was fine. Re-render such a file.
- Tiles at full size: the PNG is wider than the screen, so a whole-image view hides tile defects. Crop one column of tiles and a group at 100% (no downscaling) and look at the crop: every tile is the same size, every logo sits inside it with a margin and looks about as large as its neighbors, and tiles in one column share a center line (rules 18 and 33). Crop the nodes where several edges meet as well: every edge leaves and enters a tile at its mid-height, never from beside the name (rules 6 and 35). A logo that still looks small or crowded is a logo file with its own margin or a wide shape; see [references/icons.md](references/icons.md).

Fix the Mermaid using the rules and re-render. This loop is cheap; a diagram with crossed text is not. When a change of declaration order or an ELK option helps or fails in a way the rules do not cover, add it to mermaid-layout.md as a rule in words.

### 6. Check against the sources

Compare the picture with the sources and write three short lists:

1. Disagreements between sources (a spec says one thing, a config another). These are often the most valuable output.
2. Differences from an existing diagram, if there is one, and why.
3. Places where the diagram may mislead (a shortened label, a count whose meaning is not obvious, something drawn only from prose), and the crossings `render.mjs` printed for the delivered render, with the orders you tried.

Do not resolve disagreements in the diagram; report them to the owner.

### 7. Deliver

Deliver one file per diagram, rendered from the finished `.mmd` into the directory it goes to:

```sh
node scripts/render.mjs --portable --out <dir> <diagram.mmd>
```

| It goes to | Option | Delivers |
| --- | --- | --- |
| A repository (README, docs page), a PR or issue description, or another page that runs mermaid (GitHub or GitLab Markdown, mermaid.live) | `--portable` | `<diagram>.portable.md` |
| A chat, slide or anything else that takes only an uploaded image | `--png` | `<diagram>.png` |
| An SVG, only when the user asks for one | `--svg` | `<diagram>.svg` |

`--portable` writes one ```` ```mermaid ```` block with the logos inside as data URIs, followed by the `.mmd` in a comment: the page draws the block, and the one file is both the picture and its source. Commit the file, or paste all of it (the note, the block and the comment) into the page. Do not deliver the `.mmd`, the PNGs from step 5 or a second picture of the same diagram, such as a dark copy; the block keeps its light colors in dark mode. `--png` and `--svg` write one picture with the logos inside, in the light theme (`--theme dark` for a dark one).

Never point a node at a logo URL instead of `icon:<spec>`: GitHub blocks images from other hosts and then draws nothing at all. A `.portable.md` longer than mermaid's limit of 50,000 characters is refused; split the diagram (step 1). What each page shows of a diagram, with the versions tested: [references/embedding.md](references/embedding.md). Logo files stay in the cache.
