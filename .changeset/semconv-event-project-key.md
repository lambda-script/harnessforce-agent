---
"@harnessforce/semconv": minor
---

The `ingest-event` schema now requires `project_key`, as the Event table of the semantic conventions does.

A token's length is now counted in Unicode code points by every validator. The limit is part of the token
`pattern` instead of `maxLength`, so a validator that counts `maxLength` in UTF-16 code units (TypeBox's
`Value.Check`, for one) no longer rejects a 256 code point token of astral characters.
