# AWS, Google Cloud and Azure areas

How to draw the part of an architecture diagram that runs on a cloud provider. The icons and their terms come from each provider's icon page, linked below, and the groups are nested the way the providers' own reference architectures nest them. These rules apply only inside the provider's group; a user beside it or a SaaS outside it keeps the normal tiles, groups and edge styles.

## Icons

Each provider ships its own service icons in an icon package (a zip). Their terms allow them in architecture diagrams and documentation; redistributing the files is not confirmed, so they stay in the icons cache like every other logo and are never committed. `fetch-icons.mjs` (and `render.mjs`, for a missing icon) downloads the current package, reads it in memory and writes only the icons asked for into the cache:

```sh
node scripts/fetch-icons.mjs "fargate:aws/fargate" "run:gcp/cloud-run" "app:azure/app-service"
```

A name that is not in the package fails with the list of every name it has, rather than a near match.

| Provider | Spec | Notes |
| --- | --- | --- |
| AWS | `name:aws/<Service>` | The `AWS-` / `Amazon-` prefix is optional; acronyms work (`s3`, `rds`, `elb`, `vpc`). People inside the AWS area use `aws/General-User`. Group icons: `aws/AWS-Cloud-logo`, `aws/Virtual-private-cloud-VPC`, `aws/Public-subnet`, `aws/Private-subnet`, `aws/Region`. |
| Google Cloud | `name:gcp/<Product>` | Only core products (Cloud Run, Cloud SQL, Cloud Storage, GKE, BigQuery…) have their own icon. Every other product takes its category's icon, as Google's guide says: Cloud Load Balancing and the VPC both get Networking, Memorystore gets Databases. The Google Cloud mark is the brand logo `gcp`. |
| Azure | `name:azure/<Service>` | Short forms work (`blob`, `redis`, `vnet`, `front-door`); `azure` alone is the Azure mark. Microsoft Entra ID is a separate set: pass its official file as `name=URL`. Never crop, flip or recolor an Azure icon, and use it only for its own service. |

Give each icon a cache name that cannot collide with a brand logo (`azredis`, not `redis`): `render.mjs` looks a logo up by the name before `:`, so a brand logo of the same name would be drawn instead.

`render.mjs` draws AWS icons (specs with `aws/`) bare, filling the tile's square without the white frame: they carry their own colored square, and a white tile frames it twice. Google Cloud and Azure icons go on the normal white tile.

## Names

Write the service's full name on the node, because icons are shared between products and providers ask for it: `Amazon S3`, `AWS Fargate`, `Cloud Load Balancing`, `Azure SQL Database`. A short form goes on the role line under it (`Elastic Load Balancing` / `ALB`). Full names are long: set `wrappingWidth: 240` so they stay on one line (rule 33 of [mermaid-layout.md](mermaid-layout.md)).

## Groups

| Provider | Nesting | Style (`style <id> ...`) |
| --- | --- | --- |
| AWS | `AWS Cloud` › `Virtual private cloud (VPC)` › `Public subnet`, `Private subnet`. Show the subnet split when it is known or safe to infer: an internet-facing load balancer in public, app servers and databases in private. Global services (CloudFront, S3) stay outside the VPC. | Outline only, square corners, no tint: AWS Cloud `fill:none,stroke:#1e293b`, VPC `stroke:#8c4fff`, public subnet `stroke:#7aa116`, private subnet `stroke:#00a4a6`. |
| Google Cloud | `Google Cloud` › `VPC` › `Region <name>`. A VPC is global and a subnet regional, so the region goes inside the VPC, never the reverse. Global and serverless services (an external load balancer, Cloud Storage, Cloud Run) stay outside the VPC. | Google Cloud `fill:none,stroke:#2563eb`; VPC `fill:none,stroke:#1e293b,stroke-dasharray:4 3`; region `fill:#f8fafc,stroke:#cbd5e1`. |
| Azure | `Microsoft Azure` › `Region <name>` › `Virtual network`. A VNet belongs to one region. Front Door is global and stays outside the region. App Service stays outside the VNet unless it runs in an App Service Environment; a PaaS service reached through a private endpoint sits inside the VNet with `private endpoint` as its role. | Azure `fill:none,stroke:#0078d4`; region `fill:#f8fafc,stroke:#cbd5e1`; VNet `fill:#f5f8ff,stroke:#93b4f5`. |

Put the provider's mark, or the group icon, in front of the group title (rule 44 of [mermaid-layout.md](mermaid-layout.md)): `subgraph aws["<img src='icon:awscloud:aws/AWS-Cloud-logo' width='26' height='26' style='vertical-align:middle'/> <b>AWS Cloud</b>"]`. Mermaid draws every subgraph with square corners; `render.mjs` puts the title in the top left corner.

## Edges

Inside the AWS area, AWS draws every edge in one color: give them `stroke:#1e293b,stroke-width:1.6px` and keep the primary blue for the edge that enters the area from the user. Google Cloud and Azure keep the normal primary, secondary and deploy styles.
