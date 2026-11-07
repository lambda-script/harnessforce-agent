# ER diagrams

Tables, their key columns and how they relate. Draw it as `erDiagram`; split by domain when there are more than about 15 tables.

## Sources and what to take from them

| Source | Take |
| --- | --- |
| `schema.prisma` | `model` (entity), fields with type and `?` (nullable), `@id`, `@unique`, `@relation` (relations and their side), `@@map` (real table name) |
| The migrations next to an ORM schema | what the ORM cannot express: partial unique indexes, `CHECK` constraints, `ON DELETE SET NULL (column)` on composite keys |
| SQL migrations, `CREATE TABLE` (Postgres, MySQL, ClickHouse) | columns, primary and unique keys, `REFERENCES` |
| ORM models (Drizzle, TypeORM, SQLAlchemy, ActiveRecord) | the same, from code |
| Data docs | which domain each table belongs to; relations that exist only by column name |

Read the migrations even when the ORM schema looks complete. Prisma writes `onDelete: SetNull` on a composite key `(workspaceId, projectId)`, which read alone would null the tenant column too; the migration may set only the ID column. A rule the spec states as "at most one" may be a partial unique index, code under a lock, or nothing: say which in the checks.

## Template

```text
---
title: <system> <domain> tables
config:
  theme: neutral
  layout: elk
  elk:
    lineHops: false
    nodePlacementAlignment: RIGHTDOWN
---
erDiagram
  %% <path>:<line>
  Tenant ||--o{ Member : "tenantId"
  User ||--o{ Member : "userId"
  Member |o--o{ Connection : "connectedById"
  Connection }o..o| Filter : "installationId, inferred"

  Tenant {
    Uuid id PK
    String slug UK
    DateTime? deletedAt
  }
  Member {
    Uuid id PK
    Uuid tenantId FK, UK "unique (tenantId, userId)"
    Uuid userId FK, UK
  }

  classDef core fill:#f5f8ff,stroke:#93b4f5,stroke-width:2px
  classDef other fill:#f8fafc,stroke:#94a3b8,stroke-width:1px
  class Tenant,Member core
  class User other
```

## Shape of the diagram

- One entity per table; list the primary key, foreign keys, unique keys and the few columns the question is about. Do not list every column of wide tables.
- Attribute form: `type name PK|FK|UK "comment"`; nullable types as `String?` (mermaid 11.16+). Several keys are written `FK, UK`. A composite unique key goes as `UK` on each column and a comment on the first: `"unique (workspaceId, userId)"`.
- Relation cardinality from the schema: `||--o{` for a required parent with optional many children, `|o--o{` when the foreign key is nullable. Label each relation with the field name (`"workspaceId"`).
- Use identifying (`--`) and non-identifying (`..`) relations as in the schema: dashed for relations not enforced by a foreign key.
- When stores have no foreign keys (ClickHouse, DynamoDB), draw inferred relations dashed and say in the label that they are inferred from column names.
- Split by domain (billing, auth, telemetry); in each diagram show tables from other domains only as the targets of relations, with their key alone.
- In a multi-tenant schema every table points at the tenant. Draw that edge only for the tenant's direct children and say in a comment that the rest have it too; with every edge the tenant becomes a hub whose lines cross the whole diagram.
- Declare relations from the root outward (tenant edges first, then each child's edges), like the primary flow of mermaid-layout.md rule 11. Then declare the entities with their attributes.
- Put an icon in front of each entity's title with an alias: `Workspace["<img src='icon:ws:lucide/building-2' width='32' height='32' style='vertical-align:middle'/> <b>Workspace</b>"]`, declared before the relations; the attribute block still uses the bare name (`Workspace { ... }`). The product's mark for the tables its data fills (the GitHub mark on GitHub tables), a Lucide glyph for the others.
- Keep a diagram to about ten tables and twelve relations (as SKILL.md step 1 says for every type). An 11-table domain drawn as one diagram ran its tenant edges across the whole picture; drawn as the tenancy (5 tables) and the integration that hangs off it (9 tables, repeating the tenant tables with their keys only), neither has a line across the picture.
- Color entities by domain with `classDef` and the palette of mermaid-layout.md (Style): the dark render swaps those colors. Gray (`#f8fafc`, `#94a3b8`) for tables from other domains.

## Layout (mermaid-cli 12.2.0, mermaid 12.3.0)

- `layout: elk` works for `erDiagram`, unlike `stateDiagram-v2`: edges are orthogonal and the root sits at the top.
- `nodePlacementAlignment: RIGHTDOWN` gave the most compact render of an 11-table domain: the tenant, its children and the integration tables in three rows. `forceNodeModelOrder: true` moved the tenant to the middle and lengthened the lines on both sides.
- `direction LR` drew the same domain more than three times wider than tall, with unreadable text. Keep the default top-to-bottom.
- Two parents that share two children (a tenant and the user table, both pointing at membership and invitation) cross once when both children sit in one row, which ELK does. Accept it; do not add hints to fix it.

## Limits

- Attribute types must start with a letter and contain only letters, digits, `-`, `_`, parentheses and brackets.
- Keys are `PK`, `FK` and `UK` only; indexes and check constraints cannot be drawn. Mention important ones in a comment (`"unique while not revoked"` for a partial unique index).
- Style values in `classDef` and `style` must be whole numbers: `stroke-width:1.5px` is a lexical error, `2px` works.
- Do not give entities a dashed stroke: each row of the table is its own box, and the dashes break the borders between the header and the rows.
- Rows alternate between the class fill and the theme's row color. In the dark render the theme's rows are gray, so the class color shows on every other row only.
