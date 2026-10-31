---
"@harnessforce/cli": patch
---

`harnessforce init` no longer ends the login when its loopback receives a callback without the expected `state`, which another local process or a web page can send. That request is sent to the failure screen, and the loopback keeps waiting for the real callback until the timeout. A request the loopback cannot parse, such as `GET //`, now gets a 400 response instead of stopping the CLI.
