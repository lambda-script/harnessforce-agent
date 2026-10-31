---
"@harnessforce/semconv": minor
---

Remove what Harnessforce no longer accepts: the `hf.milestone.id`, `hf.plan.id` and `hf.plan.version` attributes, the `plan.updated`, `decision.recorded` and `release.published` event types, and the `ingest-issue` schema (`IngestIssueSchema`, `IngestIssue`, `STATUS_CATEGORIES`). The attributes and event types now match the semantic conventions and `activity_events`.
