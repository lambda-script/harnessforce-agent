---
"@harnessforce/semconv": minor
---

Add the MCP agent contract: the tools the plugin calls by name (`get_issue`, `start_session`, `complete_session`, `list_issues`), their closed input schemas and examples, the result fields the plugin reads, the error codes it branches on, and the `q` it sends. `openResult` opens a result schema so that Harnessforce can check its tool results without rejecting fields it adds.
