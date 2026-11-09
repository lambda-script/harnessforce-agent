---
"@harnessforce/claude-code-plugin": patch
"@harnessforce/cli": patch
---

When `start_session` returns `forbidden` or `conflict` (this session belongs to another user), the record-session skill now tells the user why the work cannot be linked and continues without calling `start_session` again, calling `complete_session`, or guessing another session ID, for an Issue the user named as well as one picked from the candidates. A `forbidden` or `conflict` from `complete_session` is reported and not retried. The injected introduction lists this as a Red Flag.
