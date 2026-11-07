# Architecture diagrams

What runs where, what it talks to, and which way requests and data flow. Draw it as `flowchart LR` with logos, following [mermaid-layout.md](mermaid-layout.md).

## Sources and what to take from them

| Source | Nodes | Edges | Watch out for |
| --- | --- | --- | --- |
| Terraform / OpenTofu `.tf` | `resource` and `module` blocks that are services, data stores, queues, domains | references between resources; DNS records that point at a service | Modules from a registry or git are not in the repository; say so in the group label. Values joined from strings (ARNs, CNAME targets) are edges only a reader can see. |
| `wrangler.jsonc` / `wrangler.toml` | the Worker per environment (`<name>-<env>`), R2, KV, D1, Queues, Durable Objects, Hyperdrive | binding → resource, queue producer → queue → consumer, service bindings, dead letter queues | Bindings and `vars` are not inherited by `env.<name>`; `routes` and `triggers` are. Pick one environment and do not mix in top-level (local) bindings. |
| `vercel.json` | usually nothing: it holds build settings | — | The project and domains are in Terraform or the dashboard. |
| `compose.yaml` | local services only | — | Do not put them in a production diagram. |
| Deploy workflows (`.github/workflows`) | the CI system, the identity it assumes (OIDC role) and where it reads secrets | deploy edges to each platform | These belong in the deploy diagram, not the runtime one (rule 8). |
| Architecture and environment docs | users, clients, external SaaS, calls between apps | requests, webhooks, internal endpoints | Prose is the only source for many SaaS calls; mark them as doc-derived in step 6 of the workflow. |

## Shape of the diagram

- Columns from outside in, left to right: users and clients (a borderless group), the edge or frontend platform and the main runtime platform, data stores, external services.
- One group per vendor or runtime. Nest at most one level.
- Fold sub-resources of one kind (three queues, two buckets) into one node with a role like `telemetry, webhooks, DLQ` unless the question is about them.
- Primary flow: the path a typical request or event takes from the user to its data store. Mark five or six edges as primary, not more.
- Fold edges from one node to many external services into one edge to the services group (rule 10).
- When data stores and external services are in one diagram, data stores get their own column between the runtime and external services: add `data ~~~ saas` after the primary flow (rule 23), and draw webhooks from external services, and calls from the app into the runtime platform, as label-directed lines (`ingest ---|"◀ webhooks"| saas`, rules 24–26).
- Draw the system as an overview and one diagram per layer (step 1 of `SKILL.md`; the overview's shape is under [Overview](#overview)). Each layer's diagram is titled with that node's name (`Cloudflare: telemetry ingest`) and shows what runs in it, with the neighbors it calls as nodes in their own groups. The external services split by caller when one diagram would cross most of its edges (rule 46), and a layer that both calls the services and receives their webhooks sits on either side of them (rule 48).
- On AWS, Google Cloud or Azure, nest the provider's groups (VPC, subnets, regions) and name services by their full names as [cloud-providers.md](cloud-providers.md) says.
- Deploy, IaC and DNS go into a diagram of their own: CI and IaC on the left, one node per target platform on the right, dashed edges, `lineHops: false` (rules 8, 9, 22).
- When the sources you read include IaC or deploy workflows (the user names Terraform, or `.github/workflows` deploys), deliver that deploy diagram with the runtime ones: reading the IaC and leaving its edges out of every diagram drops what the user pointed you at.
- Every node of the overview gets its own diagram, and every external service the sources name appears in one of them; check both before step 6.
- A node that stands for several services ("Stripe, OAuth, SMTP") belongs only in the overview. In the detail diagrams each external service is its own logo node with its own edge from the app that calls it, so when two layers call external services, each gets its own external services diagram (rule 46): folding one caller's services into one node hid that apps/web signs users in with Google and GitHub and connects Slack.

## Overview

The overview is five or six logo nodes and the main flows between them, with no subgraphs: a layer drawn as a group with its apps inside is a detail diagram, and in the overview such groups pulled the lines around each other. Each layer is one node: the platform's own logo for a platform, a Lucide glyph for the clients, the data stores and the external services. Its role lists what the layer holds, so the reader knows which detail diagram to open.

```text
flowchart LR
  clients@{ img: "icon:clients:lucide/users", label: "<b>Clients</b><br/><small>agents, CLI, browser</small>", pos: "b", w: 72, h: 72, constraint: "on" }
  vercel@{ img: "icon:vercel", label: "<b>Vercel</b><br/><small>apps/web</small>", pos: "b", w: 72, h: 72, constraint: "on" }
  cloudflare@{ img: "icon:cloudflare", label: "<b>Cloudflare</b><br/><small>ingest, Queues, worker, R2</small>", pos: "b", w: 72, h: 72, constraint: "on" }
  data@{ img: "icon:datastores:lucide/database", label: "<b>Data stores</b><br/><small>Neon, ClickHouse Cloud</small>", pos: "b", w: 72, h: 72, constraint: "on" }
  saas@{ img: "icon:external:lucide/plug", label: "<b>External services</b><br/><small>GitHub, Stripe, Slack</small>", pos: "b", w: 72, h: 72, constraint: "on" }

  cloudflare ---|"API, webhooks"| saas
  clients -->|"OTLP, import"| cloudflare
  clients -->|"HTTPS, MCP"| vercel
  cloudflare -->|insert| data
  vercel -->|"Prisma, read"| data

  linkStyle 0 stroke:#64748b,stroke-width:1.4px,color:#64748b
  linkStyle 1,2,3,4 stroke:#2563eb,stroke-width:2.5px,color:#2563eb
  classDef tile fill:none,stroke:none,color:#1e293b,font-size:18px
  class clients,vercel,cloudflare,data,saas tile
```

The secondary line is declared first and the primary flow last (rule 36); a relation that goes both ways is a line without arrowheads (rule 47); when two layers both call the same two layers, one of the four edges is left to a detail diagram (rule 46).

## Labels

- Node label: the product or app name, then a short lowercase role in `<small>`: `<b>ingest</b><br/><small>receive, webhooks</small>`.
- Edge label: the protocol or verb (`HTTPS`, `OTLP`, `enqueue`, `Prisma`, `webhooks`), two words at most.
- State gaps in the role instead of hiding them (`binding not set yet`).
