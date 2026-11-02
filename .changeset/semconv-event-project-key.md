---
"@harnessforce/semconv": minor
---

`IngestEventSchema` now requires `project_key`, the key of the Project an event belongs to, as the semantic conventions define for the generic ingest API event. An event without `project_key` no longer validates.
