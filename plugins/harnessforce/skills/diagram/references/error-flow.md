# Error-handling flows

What happens when a step fails: which errors are retried, which go to a dead letter queue, which reach the user and as what. Use `flowchart TD` for one component's decision flow, and `sequenceDiagram` (see [sequence.md](sequence.md)) when the failure crosses components.

## Sources and what to take from them

| Source | Take |
| --- | --- |
| Error classes (`errors/`, `*Error` types) and their codes | the error kinds; group them by how they are handled, not one node each |
| API boundary (error mappers, middleware, tRPC/GraphQL error formatters) | which errors become which status or code for the client, and which are logged or reported |
| Queue and job config (`max_retries`, `dead_letter_queue`, backoff, timeouts) | retry counts, where messages go after the last retry |
| Handlers (`try`/`catch`, `retry()`, `ack`/`nack`) | which errors are retried, swallowed or re-thrown |
| Specs on failures and user-facing messages | the intended behavior to compare with the code |

## Shape of the diagram

- Top to bottom: the request or message enters at the top, the happy path runs straight down as the primary flow (blue), failures branch to the side (gray). Set `nodePlacementAlignment: RIGHTDOWN` so the happy path stays in one column (mermaid-layout.md rule 30).
- Decisions as one-line hexagons (`ok{{every step ok?}}`), not diamonds: diamonds grow with their text and made the example flow about a third taller (rule 29).
- End nodes for each outcome: success, response with a code (`400 VALIDATION`), dead letter queue, alert, dropped. Give outcomes a consistent `classDef` from the palette, which the dark render swaps: success green (`#f0fdf4`/`#86efac`), user-facing amber (`#fff7ed`/`#f59e0b`), dead letter red (`#fef2f2`/`#f87171`), dropped gray (`#f8fafc`/`#94a3b8`). Do not fill with `#ffffff`; it is not swapped.
- End every retry edge at one `retry[[retry the message]]` node with a single edge back to the queue (rule 31). Put the delay or count on each incoming edge (`yes: in 30 s × 2^(n−1), max 15,360 s`) with its source line in a `%%` comment.
- Draw who acts as logo tiles (the queue, the worker, the database the step writes, Sentry where a failure is reported) and keep the decisions as hexagons. In `flowchart TD` the tiles need no `mergeEdges`: edges enter a tile from above and leave from under its label.
- Three edge colors: the happy path blue, failures red (`stroke:#dc2626`), retries orange (`stroke:#d97706`, waiting); the platform's own redelivery dotted gray.
- Keep each diagram to about ten nodes. Split where a message changes hands, at the dead letter queue: the consumer's flow ends at a node for the dead letter queue ("see the next diagram"), and the dead letter consumer's flow starts from the consumer that gave up. A short flow such as the dead letter consumer (about six steps in its longest path) reads better as `flowchart LR` with `mergeEdges: true`: drawn top to bottom, the edge into its group crossed the group's title. A longer one stays `flowchart TD`: in `LR`, eleven steps came out as one row five times wider than tall.
- Follow a dead letter to its end: the consumer of the dead letter queue, where its row or count is shown to people, and when the platform deletes it. That end is usually what the user sees.
- Draw the platform's own redelivery (an uncaught exception, a timeout) as a dotted edge, apart from the retries the code decides.
- Fold a rare branch into an edge label when it only shortcuts the same path (`no: in 30 s; the next try only sends again`), and list it under "may mislead".

## Pitfalls

- A queue without a dead letter queue drops a message after its last retry; draw that drop explicitly.
- Defaults matter: when the config sets no retry count, look up the platform's default and cite it.
- Compare the words people see with the flow. A count of dead letters labelled "Waiting to retry" on a screen promises a retry that nothing performs; report it as a disagreement.
- A retry count in the queue config and one in the code can both exist (in the telemetry-failures example, `max_retries: 100` in the queue config and 11 attempts in the job envelope). Find which one ends the flow and which only bounds a failure of the error handling itself.
