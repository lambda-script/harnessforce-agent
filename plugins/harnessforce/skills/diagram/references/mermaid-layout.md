# Mermaid layout rules

Rules for making Mermaid flowcharts readable at a glance, learned by changing one ELK or dagre setting or one writing habit at a time and comparing the renders. The target look: logos on white tiles, grouped boxes, straight orthogonal edges, one primary flow.

- Verified with `@mermaid-js/mermaid-cli` 12.2.0 (mermaid 12.3.0). ELK ships with mermaid; `layout: elk` needs no extra package.
- Each rule was found on an architecture diagram of about 20 logo nodes in five groups (clients, a runtime platform, data stores, external services, deploy). Reproduce a rule by rendering a small diagram before and after the change; keep the experiments out of the repository.
- When the mermaid version changes, re-render at least the template below and check that the rules still hold.

## Contents

- [Template](#template)
- [Style](#style)
- [Rules](#rules): type and engine (1–2), ELK options (3–7, 22, 30), what to draw in one diagram (8–10, 28, 31, 36, 46, 52), declaration order (11–14), rows and columns (15–17, 23–26, 32, 34, 37–40, 42, 47–49, 53), looks (18–21, 27, 29, 33, 35, 41, 43–45, 50–51, 54)
- [Known gaps](#known-gaps)

## Template

```text
---
title: <system> <environment> architecture
config:
  theme: neutral
  layout: elk
  elk:
    forceNodeModelOrder: true
    mergeEdges: true
  flowchart:
    nodeSpacing: 50
    rankSpacing: 80
    wrappingWidth: 200
---
flowchart LR
  subgraph clients[" "]
    browser@{ img: "icon:browser:lucide/app-window", label: "<b>Browser</b><br/><small>users</small>", pos: "b", w: 72, h: 72, constraint: "on" }
  end
  subgraph vendor["Vendor"]
    app@{ img: "icon:nextjs", label: "<b>apps/web</b><br/><small>UI, API</small>", pos: "b", w: 72, h: 72, constraint: "on" }
  end
  subgraph data["Data stores"]
    db@{ img: "icon:neon", label: "<b>Neon</b><br/><small>Postgres</small>", pos: "b", w: 72, h: 72, constraint: "on" }
  end

  %% secondary calls first, the primary flow last (rule 36); edges that point back: rule 11
  browser -->|HTTPS| app
  app -->|SQL| db

  linkStyle 0,1 stroke:#2563eb,stroke-width:2.5px,color:#2563eb
  style clients fill:none,stroke:none
  style vendor fill:#f5f8ff,stroke:#93b4f5,stroke-width:1.5px
  style data fill:#f5f8ff,stroke:#93b4f5,stroke-width:1.5px
  classDef tile fill:none,stroke:none,color:#1e293b,font-size:18px
  class browser,app,db tile
```

Try `nodePlacementAlignment: RIGHTDOWN` under `elk:` as well and keep whichever render is more compact (rule 4).

The overview of an architecture drawn in layers has no groups at all: [architecture.md](architecture.md), Overview.

## Style

Use these colors; `scripts/render.mjs` swaps exactly these for their dark counterparts when it renders the dark PNG. Other colors stay as written in both themes. The dark render switches the theme only through a frontmatter `config.theme` line, as in the template; a `%%{init}%%` directive is not changed.

| Use | Light | Dark |
| --- | --- | --- |
| Primary edge | `stroke:#2563eb,stroke-width:2.5px,color:#2563eb` | `#60a5fa` |
| Secondary edge (internal calls, queues, external APIs) | `stroke:#64748b,stroke-width:1.4px,color:#64748b` | `#94a3b8` |
| Deploy and IaC edge | `stroke:#64748b,stroke-width:1.4px,stroke-dasharray:5 5,color:#64748b` on a `-.->` edge | `#94a3b8` |
| Failure edge (a check fails, a message gives up) | `stroke:#dc2626,stroke-width:1.6px,color:#dc2626`, dashed (`stroke-dasharray:6 4`) when the failure is a condition rather than a step | `#f87171` |
| Waiting edge (a retry with its delay) | `stroke:#d97706,stroke-width:1.6px,color:#d97706` | `#fbbf24` |
| DNS or other weak link | `stroke:#94a3b8,stroke-width:1.2px,stroke-dasharray:2 4` | `#64748b` |
| Group, default | `fill:#f5f8ff,stroke:#93b4f5,stroke-width:1.5px` | `#16213a` / `#3b5ea8` |
| Group, vendor accent (orange) | `fill:#fff7ed,stroke:#f59e0b,stroke-width:1.5px` | `#2a1f12` / `#b45309` |
| Group, green | `fill:#f0fdf4,stroke:#86efac,stroke-width:1.5px` | `#12261a` / `#2f855a` |
| Node, red (dead letters, failures) | `fill:#fef2f2,stroke:#f87171,stroke-width:1.5px` | `#2a1416` / `#b91c1c` |
| Group, nested or neutral | `fill:#f8fafc,stroke:#cbd5e1,stroke-width:1.5px` | `#1e293b` / `#475569` |
| Group used only as a column | `fill:none,stroke:none` | same |
| Tile (`classDef tile`, image nodes only) | `fill:none,stroke:none,color:#1e293b,font-size:18px`; `render.mjs` draws the white rounded tile (stroke `#cbd5e1`) around each logo | same tile, text `#e2e8f0` |

## Rules

### Type and engine

- **Rule 1: Use `layout: elk` for architecture diagrams.** Compared with dagre, edges are orthogonal, groups gather into columns and the left-to-right flow reads. dagre draws curves diagonally between nodes and scatters groups.
- **Rule 2: With dagre, set `flowchart.curve: step` for right angles.** Edges entering one node still meet at one point and nodes in a subgraph can line up in one row, so ELK is still better.

### ELK options (`config.elk`)

mermaid 12.3.0 accepts `mergeEdges`, `straightenEdges`, `lineHops`, `preset`, `nodePlacementStrategy`, `layeringStrategy`, `cycleBreakingStrategy`, `layeringLayerBound`, `nodePlacementAlignment`, `forceNodeModelOrder`, `considerModelOrder`, `keepEntryNodeOnTop` and `orientFeedbackEdges` (checked in the default config shipped in mermaid's `dist`).

- **Rule 3: `forceNodeModelOrder: true` tightens the layout.** Fewer long detours; external services and data stores line up in the right-hand column. It does not make the vertical order follow the declaration order, so it cannot be used to order nodes.
- **Rule 4: `nodePlacementAlignment: RIGHTDOWN` puts the primary flow on one row.** Compared with the default `BALANCED`, the ingest → queue → worker chain comes to the same height and the diagram gets shorter. `LEFTUP` looks like the default. It does not always help: once Data stores and External services are split into two columns (rule 23), `RIGHTDOWN` spread the diagram vertically and the default was more compact. Render both.
- **Rule 5: Keep `nodePlacementStrategy` at its default (`BRANDES_KOEPF`).** `NETWORK_SIMPLEX` and `LINEAR_SEGMENTS` look the same; `SIMPLE` widens the diagram and adds bends.
- **Rule 6: Set `mergeEdges: true` in a diagram of image nodes, so edges meet the tiles.** ELK sees an image node as one box of the tile and the label under it, and spreads the edges of a side over the whole box, so in the architecture diagram the OTLP and import edges left from beside the names, not from the tiles. With `mergeEdges: true` ELK attaches every edge of a side at the middle of that side, and `render.mjs` pads each tile on the side away from its label by the label's height, which puts the middle on the tile's mid-height. The groups kept their columns in the architecture, CI and deploy diagrams. The costs: edges on one side of a node share their last segment, and the edge declared last paints it (a primary edge turned gray next to the node until the primary flow was declared last, rule 36; a dashed one joins a solid one); the empty space above each tile makes a column taller by the label's height per node (the architecture diagram grew from 2444 to 3244 px). Before the template had `forceNodeModelOrder` and rules 23–26, the same option scattered the groups.
- **Rule 7: Settings that do nothing or break the render.** `layeringStrategy` (`LONGEST_PATH`, `LONGEST_PATH_SOURCE`, `COFFMAN_GRAHAM`) leaves the layout unchanged. `cycleBreakingStrategy: MODEL_ORDER` and `GREEDY_MODEL_ORDER`, and `preset: modelOrder` together with `forceNodeModelOrder`, fail on diagrams with edges between subgraphs: `TypeError: Cannot read properties of undefined (reading 'a')`. `cycleBreakingStrategy: DEPTH_FIRST` gives the same layout as the default and `INTERACTIVE` a worse one. `considerModelOrder` (`NODES_AND_EDGES`, `PREFER_EDGES`, `PREFER_NODES`) does not change which edge of a cycle is reversed, so it cannot fix rule 24.
- **Rule 22: Set `lineHops: false` when a diagram has dashed edges.** By default ELK draws a small hop where an edge crosses another, and an edge with a hop loses its dash: three of the nine deploy edges came out solid. With `lineHops: false` every dashed edge stays dashed.
- **Rule 30: In a top-to-bottom decision flow, `nodePlacementAlignment: RIGHTDOWN` keeps the happy path in one column** (rule 4 for `LR`). With the default `BALANCED`, `LEFTUP` or `RIGHTUP`, each decision moved the next step one column sideways and the happy path became a staircase; those renders were 15–35% shorter, but the path no longer read as one line. The `nodePlacementStrategy` values `NETWORK_SIMPLEX`, `LINEAR_SEGMENTS` and `SIMPLE` made the flow taller.

### What to draw in one diagram

- **Rule 8: Put deploy and IaC edges in a separate diagram.** Dashed deploy edges in the architecture diagram run from edge to edge of the picture and bury the runtime flow. A small diagram drawn from a description that names one deploy step ("GitHub Actions deploys") keeps that step as one dashed edge in the same diagram (rule 38): split out, it became a diagram of two nodes.
- **Rule 9: In the deploy diagram, draw each deploy target as one node per platform.** An edge to a group (subgraph) draws every node of that group and makes the diagram tall.
- **Rule 10: Fold edges to several external services into one edge to their subgraph** (`web --> saas`). With ELK an edge to a subgraph ends on its border.
- **Rule 28: A subgraph can also be the source of an edge.** `light --> result` leaves from the group's border, so jobs that share their `needs` take one edge in and one edge out of their group instead of one per job. In a CI diagram with three light suites and two heavy suites, the eleven edges between the path filter, the suites, the build and the gate became four.
- **Rule 36: Declare the secondary calls first and the primary flow last.** With `mergeEdges` (rule 6) the edge declared last paints the segment several edges share, so the OTLP and insert lines of the harnessforce architecture stayed blue to their arrowheads. A diagram with no edge pointing back keeps its groups where they are (rule 11 is about cycles). The same architecture as one diagram of 23 edges had lines to Postgres, to ClickHouse, from the webhooks and to the external services across or around the whole picture; split as `SKILL.md` step 1 says, none of its diagrams has one.
- **Rule 31: Collect retry edges into one `retry` node with one edge back to the queue.** Three decisions that each retried the message drew three lines up the whole height of an error-handling flow; ending them at one `retry[[...]]` node at the bottom left one line going back, and each delay stays on its own incoming edge's label.
- **Rule 52: Explain the colors in the Markdown next to the diagrams, not in a legend group.** A `legend` subgraph with three pairs of blank nodes joined by a primary, a secondary and a failure edge rendered, but ELK put it top left, above the triggers, made the CI diagram 30% taller (1950 to 2526 px) and ordered its three rows as it chose (rule 37). One table of line styles under the heading of the examples serves every diagram.
- **Rule 46: When two layers both call the same two layers, leave one of the four edges to a detail diagram.** In an overview where Vercel and Cloudflare each called both Data stores and External services; the four edges crossed once in every declaration order, because two columns of two nodes joined all to all cannot be drawn without a crossing. Without Vercel → External services (drawn in Vercel's detail diagram instead) the overview has none. The same held at the next level: apps/web and the worker both calling GitHub and Stripe, with the webhooks into ingest, crossed most of the eleven edges of one services diagram; one diagram per caller crossed none.

### Declaration order

- **Rule 11: With ELK, the order of edge declarations moves group columns. Declare the primary flow first, secondary calls next and edges that point back (a worker calling the receiver that feeds it) last.** Reversing the order moved the external services to the left of the main vendor group. ELK appears to break cycles in declaration order.
- **Rule 12: A back edge plus `~~~` can move a whole group to the left.** Adding `~~~` from data stores to external services, together with the webhook edge from external services back to the receiver, moved both groups left of the main vendor group. ELK uses `~~~` as a forward edge.
- **Rule 13: With dagre, the vertical order of nodes in one rank follows the edge declaration order, not the node declaration order.** With `s --> p`, `s --> q`, `s --> r`, declaring the nodes `r`, `q`, `p` first changes nothing; declaring the edges in `r`, `q`, `p` order flips the column.
- **Rule 14: With dagre, the declaration order of subgraphs does not decide left and right.** Edge direction does. Subgraphs declared A, B, C and C, B, A give the same layout.

### Rows and columns

- **Rule 15: `direction` inside a subgraph is ignored once an edge from outside enters a node in it.** It applies only when edges point at the subgraph itself (dagre). `u --> S` keeps the subgraph's `direction TB`; `u --> x1` lays it out horizontally again. In architecture diagrams external services receive edges from outside, so `direction TB` cannot stack them.
- **Rule 16: `~~~` does not put two nodes on one row; it pushes the second one column to the right** (dagre).
- **Rule 17: More dashes in an edge move its target further right** (dagre, `a ----> d`).
- **Rule 23: To give two groups that end in the same ELK layer their own columns, add `first ~~~ second` between the groups right after the primary flow.** Data stores and External services both receive edges from the last runtime nodes, so ELK puts them in one column and the app's lines to the data stores run around the whole diagram. With `data ~~~ saas` and no edge from External services back into the runtime, the columns become clients, runtime, Data stores, External services, and the Prisma and read lines become short.
- **Rule 24: A real edge pointing back across the hint wins over `~~~`.** With `data ~~~ saas` and `saas -->|webhooks| ingest`, ELK broke the cycle elsewhere and moved the whole Cloudflare group to the far right. Adding `~~~` hints in the wanted direction does not help: ELK reverses the hints instead. No ELK option changes this (rule 7).
- **Rule 25: When a call goes against the layout direction and must not move groups, draw it as a line without an arrowhead in the layout direction and put the direction in its label:** `ingest ---|"◀ webhooks"| saas`. ELK then treats it as a forward edge. Keep the arrow glyph pointing at the receiver as drawn (here ingest is left of External services), and check it after every layout change. Use it only for the edges that rule 24 says would pull the layout and for the calls back of rule 34, after a render with a real arrow showed the pull; keep real arrows everywhere else. A fresh agent used it in a six-node diagram (`notion ---|"◀ sync docs"| inngest`) where `notion -->|docs| inngest`, the way the docs go, laid out the same; the glyph showed as a large arrowhead in the middle of the line.
- **Rule 26: An app that calls the main platform gets its own column left of it.** `web -->|internal endpoints| ingest` puts Vercel in a column before Cloudflare, and then every line from the app to the data stores runs below Cloudflare. Drawn as in rule 25 (`ingest ---|"◀ internal endpoints"| web`), the app sits next to the data stores and its lines are short.
- **Rule 34: With `mergeEdges: true`, draw a call back between two nodes of the main flow as in rule 25.** `worker -->|re-enqueue| queues` ended on the same point of Queues that consume left from, and the shared segment read as one two-way arrow; so did `worker -->|update gate| ingest` next to enqueue. `queues ---|"◀ re-enqueue"| worker` keeps the flow's arrowheads alone.
- **Rule 32: With ELK, `direction TB` inside a subgraph of a `flowchart LR` is ignored as well, under the same condition as rule 15** (an edge from outside enters a node in the subgraph). Two subgraphs of ten nodes each came out as one row about nine times wider than tall. For a long decision flow use `flowchart TD`.

- **Rule 37: The declaration order of nodes in a group changes their vertical order, but not to that order; render the orders and keep the one with the fewest crossings.** In the primary-flow diagram (`forceNodeModelOrder: true`), the three clients came out with the last declared node on top and the others below in their order, in all five orders tried: declaring CLI, Claude Code, Browser drew Browser, CLI, Claude Code, which leaves one crossing (MCP over import) where the other orders left one or two crossings and a detour. Declaring the Vercel group after the Cloudflare group put apps/web above Cloudflare, next to Browser. Nodes without edges of their own (external services reached through an edge to their group) came out in an order no declaration predicted. In the CI diagram, the triggers declared pull_request, label, run on main came out in that order with the primary edge from pull_request crossing the run-on-main edge; declared run on main, label, pull_request, they came out pull_request, label, run on main, without a crossing.

- **Rule 38: With `nodePlacementAlignment: RIGHTDOWN`, the declaration order of the groups that share a column decides which one sits on the primary row; render both orders.** In a small web-app diagram (user → Next.js → Hono → Neon, with GitHub Actions deploying), the user and the GitHub group share the first column. Declared clients first, GitHub took the top and the HTTPS edge bent down to Next.js; declared GitHub first, the user, Next.js and Hono came out on one straight row with GitHub below. In a tooling diagram, declaring the npm registry before the workspace group put npm on the `git push` row; declared after it, the publish edge ran down around the workspace. Without `RIGHTDOWN` neither order gave a straight row.
- **Rule 39: In a fan-out from one node, declare the secondary edge after the primary one to keep the primary target on the row, and accept that the merged segment takes the secondary color.** Fargate → RDS (`SQL`, primary) and Fargate → ElastiCache (`cache`) leave Fargate at one point (rule 6). With `cache` declared first, ElastiCache took the row and RDS went below; with `cache` declared last, RDS came onto the row. The segment the two edges share is then drawn in the color of `cache` (rule 36 in reverse); inside an AWS area, where every edge has one color, that costs nothing. The declaration order of the two target nodes changed nothing.
- **Rule 40: Two nodes of one group in the same layer, reached from one fan-out, may keep their vertical order whatever is declared.** Front Door → Blob Storage (`/*`) and Front Door → App Service (`/api/*`) inside one region group put Blob Storage on top in every order tried (node order, edge order, Blob declared after the nested VNet group, with and without `RIGHTDOWN`), so the primary row turned down at Front Door. When this happens, keep the order with no crossings and leave it.

- **Rule 42: An invisible group around a node and its secondary target keeps the target next to its source.** CloudFront → S3 (`/*`) put S3 one column right and below the whole VPC, with a line across the empty space. With CloudFront and S3 declared in a `subgraph edge[" "]` (`fill:none,stroke:none`), S3 came to the right of CloudFront on its row and the diagram became a quarter shorter; the same worked for Cloud Load Balancing and Cloud Storage. `direction TB` inside that group is ignored (rule 32), so the target sits beside its source, not under it, and the primary edge leaving the source bends once.
- **Rule 53: Nest a job's steps in one group per platform inside the job's group; the row stays straight.** The six steps of a deploy job, nested as Data stores (migrate, schema), Cloudflare (two Workers) and Vercel (the app) inside `deploy.yml`, kept one straight primary row; with rule 43's spacing the diagram was also narrower than the flat group (5904 to 5544 px at scale 2). The nested titles carry the platform's mark, so a step's logo and its group say the same thing twice only where a step changes that platform.
- **Rule 47: Draw a two-way relation as a line without arrowheads (`a ---|"API, webhooks"| b`), not with `<-->`.** With `mergeEdges: true` the arrowhead at the start of `cloudflare <-->|...| saas` landed on the point of Cloudflare where the clients' edges arrive, and read as a third incoming arrow.
- **Rule 48: When a group both receives calls from one app and sends webhooks to another, put the caller on its left and the receiver on its right.** worker → GitHub, Stripe, Slack, Resend with GitHub, Stripe → ingest, drawn with ingest and worker in one Cloudflare group, needed the webhooks against the flow (rule 25), and in every order tried a webhook line crossed the worker's edges. With the two Workers as plain nodes on either side of the services group, every edge runs left to right and none crosses.
- **Rule 49: To fold a long row, draw the call that sets a secondary node one layer further as in rule 25, and add `nodePlacementAlignment: RIGHTDOWN`.** In the ingest diagram, `worker --> r2` put R2 in its own layer after worker, and the nine nodes made six columns, 2.8 times wider than tall, with small text at page width. `r2 ---|"◀ read, write"| worker` put R2 in the layer of Queues; with `RIGHTDOWN` (rule 38) the primary row ingest, Queues, worker, ClickHouse came out straight and R2 and Workspace gate went under Queues. The diagram had five columns and was 2.1 times wider than tall. Without `RIGHTDOWN`, Queues went above the row and the primary flow bent twice. The spacing was set to rule 43's `nodeSpacing: 30` and `rankSpacing: 50` as well; alone, that did not change this diagram's size.

### Looks

- **Rule 18: Give image nodes the `tile` class with `fill:none,stroke:none`.** `render.mjs` puts every logo on the same 60-unit white rounded tile, fitted into a 34-unit box (up to 44 units wide for a wide logo), so tiles are equal and logos look equally large. Mermaid's own frame around the image is square and would show around the rounded tile; with `theme: neutral` it is also gray.
- **Rule 19: Style edges with `linkStyle` in three kinds** (see [Style](#style)). `linkStyle` indexes count edges in declaration order, `~~~` included, so declare edges grouped by kind and recount the indexes after every change. An index past the last edge stops the render with `TypeError: Cannot set properties of undefined (setting 'style')`.
- **Rule 20: Do not enlarge text with `themeVariables.fontSize`.** Node text stays the same and edge labels wrap and break. For readable text, use rule 27 or render at a higher scale (`render.mjs --scale`). `look: neo` changes almost nothing.
- **Rule 21: There is no arrowhead at the start only.** `a <--|label| b` and `a <--- b` are parse errors. `a <-- label --- b` parses but draws `a → b` with the head at `b`, the opposite of what it looks like. Write back edges forward and put them last (rule 11), or use rule 25.
- **Rule 27: Make tiles and names larger with `w: 72, h: 72`, `<b>Name</b>` in the label and `font-size:18px` in `classDef tile`.** The class font size applies to image-node labels; text inside `<small>` stays small, which keeps the role line secondary.
- **Rule 33: Tiles in one column line up only when their nodes are equally wide.** An image node is as wide as its label, and ELK lines up the nodes of a column by one edge, not by their centers: Browser, Claude Code and CLI came out with their tiles up to 35 px apart. `render.mjs` gives every image-node label the diagram's `wrappingWidth` as its minimum width, which lines the tiles up; keep labels shorter than `wrappingWidth` (200 px by default) or the long one shifts its tile again. Set `wrappingWidth` in the YAML frontmatter: `render.mjs` does not read it from a `%%{init}%%` directive. No ELK option helps: mermaid passes ELK no per-node alignment. `render.mjs` passes its own `themeCSS` through the mermaid config, which clears the label boxes that the wider labels would otherwise show over group fills. The config would replace a `themeCSS` in the diagram's frontmatter, so `render.mjs` appends the frontmatter's after its own (rule 54).
- **Rule 35: Break a long name or role with `<br/>` instead of letting it wrap.** `render.mjs` counts label lines by `<br/>` to center the tile (rule 6); a label that wraps is taller than counted, and its tile sat higher than the rest of its row (`apply ClickHouse schema` in the deploy diagram).
- **Rule 29: Write decisions as hexagons (`id{{question?}}`), not diamonds (`id{question?}`), and keep the question on one line.** A diamond grows in both directions with its text; with two-line questions a draft error-handling flow of nine decisions was 6,200 px tall at scale 2, and the same flow with hexagons 4,700 px. One-line questions keep every hexagon the same height.
- **Rule 41: AWS service icons go without the white tile.** They carry their own colored square; on the 60-unit tile they were fitted into its 34-unit box and looked half the size of the brand logos beside them, framed twice. `render.mjs` draws a spec with `aws/` bare, filling the tile's square ([cloud-providers.md](cloud-providers.md)).
- **Rule 43: In a diagram of about ten nodes, use `nodeSpacing: 30`, `rankSpacing: 50` and a `wrappingWidth` just above the longest label.** Six diagrams of about ten nodes, drawn from one-paragraph descriptions, came out sparse with the template's 50, 80 and 200: every image-node label is widened to `wrappingWidth` (rule 33), so short labels left wide gaps. With 30, 50 and 160 (200 for cloud diagrams, whose service names are long) the same layouts were 10–12% narrower. `layeringStrategy: MIN_WIDTH` and `BF_MODEL_ORDER` and `nodePlacementStrategy: LINEAR_SEGMENTS` made them worse, and `layeringStrategy: STRETCH_WIDTH` did not finish within two minutes.
- **Rule 44: Put the vendor's mark in front of a group title with an `<img>` whose `src` is an icon spec.** `subgraph vercel["<img src='icon:vercel' width='26' height='26' style='vertical-align:middle'/> <b>Vercel</b>"]` draws the mark on its white tile (bare for AWS icons, rule 41) beside a bold title; `render.mjs` replaces the quoted `icon:<spec>` as it does for nodes, then moves every group title from mermaid's center to the group's top left (12 px in, 6 px down) and draws the mark in front of the name through CSS, because GitHub's mermaid removes an `<img>` from a group title. It finds the title's place in a first render, so a diagram with groups takes one render more.
- **Rule 45: Color an edge's label like the edge with `color:` in its `linkStyle`.** `linkStyle 3,4,5 stroke:#2563eb,stroke-width:2.5px,color:#2563eb` draws `HTTPS` in the primary blue, so the label reads as part of its edge. The dark theme puts edge labels on gray boxes, on which blue text was hard to read; `render.mjs` gives them the page color in the dark render. On a group's fill a box of the page color still showed as a dark patch, so `render.mjs` gives the label of an edge between two nodes of one filled group that group's fill, in both themes (the innermost filled group holding both ends; `style <group> fill:` must be set). It reads group membership only from node lines inside a subgraph (`id`, `id[...]`, `id@{...}`), not from edge lines or `:::`, and only plain edges (`a -->|x| b`), not chains or `&` lists; a label it misses stays on the page color.

- **Rule 50: Put a mark on every group that a product or tool runs, not only on vendor groups.** In a CI diagram, the triggers group takes the forge's mark (GitHub) and each group of jobs the CI system's (GitHub Actions), with the bold group name before the condition: `"<img src='icon:actions' …/> <b>Light suites</b>: every push"`. A logo file with empty space inside its viewBox (GitHub Actions' mark) comes out smaller than its neighbors at 26 px; it is still recognizable, so keep the official file (icons.md).
- **Rule 51: Color an outcome by putting its tile in a one-node group with the outcome's fill.** Tiles are white in both themes and do not take a `classDef` fill, so a green `Pass` group around the merge and a red `Fail` group around the issue a failed run opens carry the outcome. In the CI diagram the two groups came out stacked right of the gate, with the success edge on the primary row.
- **Rule 54: A `themeCSS` line in the frontmatter reaches the SVG.** `render.mjs` appends it to its own CSS (after the palette swap, so its hex colors turn dark too). It is what lightens a Gantt chart's grid lines, which `gridColor` does not reach (gantt.md). Write it as one quoted line under `config:`.

## Known gaps

- There is no way to fix the vertical order of nodes in a column (rules 3 and 13); trying declaration orders (rule 37) finds a good one but not any order: Mermaid cannot be told "browser, agent, CLI from top to bottom".
- Lines drawn per rule 25 have no arrowhead; their direction is only in the label.
- Text is small relative to the tiles; `--scale` enlarges everything equally.
- The shared last segments of merged edges (rule 6) take the color of the edge declared last. Declaring the primary flow last keeps it blue (rule 36), but in a diagram with edges pointing back that order can move groups (rule 11).
- A secondary target of a node is placed in the next layer, never under its source; rule 42 brings it beside its source at the cost of one bend in the primary edge. Diagrams come out wider than a grid placed by hand.
