---
"@harnessforce/cli": minor
---

`hf init` stores the ApiToken as an access token and refresh token pair and revokes the keychain's previous tokens by their refresh token hash. `hf import` and `hf run --issue` refresh the access token under `~/.harnessforce/token.lock` when it has expired or the Read API answers 401, and ask to run `hf init` again only when the refresh fails.
