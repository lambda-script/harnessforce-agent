# Logos and icons

How to pick the image for each node. Readers know the real logos, so a wrong or redrawn one is noticed at once.

## Where logos live

Logos are not committed to the repository that holds the diagram. A node names its logo with a spec, `img: "icon:<spec>"`, and `render.mjs` looks it up by name (the part before `:` or `=`):

1. the icons cache, `${XDG_CACHE_HOME:-~/.cache}/harnessforce-diagram/icons` (or `--icons-dir`),
2. otherwise it fetches the spec into the cache,

and embeds the file, on its tile, as a data URI. The skill ships no image files.

`--no-fetch` makes a missing logo an error instead. The rendered PNG and SVG carry the logos; the `.mmd` carries only the specs.

Write every spec in full in the `.mmd`, so that it renders the same for someone with an empty cache. Never copy a file into the cache by hand and name it bare (`icon:workers`): a fresh agent copied the repository's own Cloudflare logos into its cache, and its diagrams then failed for everyone else. A logo file in the repository is a spec too, `name=<path relative to the .mmd>`. The same goes for a logo fetched by hand with `fetch-icons.mjs list:lucide/list-checks`: the `.mmd` says `icon:list:lucide/list-checks`, not `icon:list`. `render.mjs` refuses a bare spec whose cached logo was fetched under a fuller one and prints the spec to write.

Each logo is placed on the same white rounded tile and fitted into the same box, centered, without changing its colors or shape. To keep diagrams short, `render.mjs` drops an SVG logo's `<title>` and the space between its tags and rounds its coordinates to two decimals, which moves no point by a visible fraction of a pixel. Lucide icons draw inside a 2-unit margin of their 24-unit grid, which `render.mjs` crops so they look as large as brand marks. A brand file with empty space inside its own viewBox looks smaller than its neighbors: find a tighter official file rather than editing it.

## Fetching

```sh
node scripts/fetch-icons.mjs [--icons-dir <dir>] <spec>...
```

| Spec | Meaning | Example |
| --- | --- | --- |
| `name` | slug equals name | `neon` |
| `name:slug` | a different slug | `workers:cloudflare-workers`, `actions:githubactions` |
| `name:lucide/<icon>` | a Lucide line icon for a concept | `queue:lucide/list-ordered`, `cron:lucide/clock` |
| `name=URL` | the official file from the brand's site or repository | `orpc=https://orpc.unnoq.com/logo.svg` |
| `name=path` | an official file kept in the repository, relative to the `.mmd` (to the working directory when given to `fetch-icons.mjs` itself); no spaces in the path | `workers=../vendor/cloudflare-workers.svg` |
| `name:aws/<x>`, `name:gcp/<x>`, `name:azure/<x>` | a service icon from the provider's official package | `fargate:aws/fargate`, see [cloud-providers.md](cloud-providers.md) |

For brand logos the script tries svgl (exact title match), then devicon, then gilbarbara/logos, writes `<name>.svg` (or `.png`, `.webp`) and records the source URL in `manifest.json`. It prints `FAIL` when no source has the logo. A name stands for one logo in the whole cache: `render.mjs` fetches a spec again when the cached logo of that name came from another spec.

## Rules

- **Official marks only, never recolored.** Do not use simple-icons (monochrome redraws). When every source fails, find the official file in the project's repository (`logo*.svg`, `docs/`, `assets/`, `public/`) or site (`/logo.svg`, `/favicon.svg`) and pass it as `name=path` or `name=URL`. When the repository keeps its own vendor logos and a policy for them, use those files the same way.
- **White logos.** Tiles are white in both themes. If the script flags a white fill, look at the SVG: a white detail on a colored mark is fine. A mark that is white overall needs its dark-background variant from the brand; never change its fill.
- **Sub-products without their own logo** (Cloudflare Queues, R2, Durable Objects) reuse the vendor's logo; the node name tells them apart.
- **Concepts without a brand** (browser, user, server, device, internet, CLI, queue, cron, email, secrets) use a Lucide icon (`name:lucide/<icon>`, browse lucide.dev/icons): `browser:lucide/app-window`, `user:lucide/user`, `server:lucide/server`, `device:lucide/smartphone`, `internet:lucide/globe`. No text in a tile, no emoji.
- **Cloud provider service icons** (AWS, Google Cloud, Azure) come from each provider's official icon package, fetched into the cache and never committed. How to fetch them, which name each product takes, and why AWS icons are drawn without the white tile: [cloud-providers.md](cloud-providers.md).
- **Credit the sources** where the diagram is published (for example "Logos: svgl, devicon, Lucide"). Brand logos remain trademarks of their owners.
