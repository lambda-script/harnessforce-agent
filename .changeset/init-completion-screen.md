---
"@harnessforce/cli": minor
---

Redirect the browser to the Harnessforce completion screen after `harnessforce init`. The loopback holds its response until the result is known, then answers with a 303 to `/cli/connected` with a fixed status. The code, the state, and the error description are never put in the URL.
