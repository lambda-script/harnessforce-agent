# CLI ApiToken refresh

`hf init`がaccess tokenとrefresh tokenの組を保存し、`hf import`と`hf run --issue`がRead APIの前にrefreshするようにする。

## 根拠（harnessforceの`docs/specs`）

- `features/correlation.md`「CLI」手順1、3〜5、「ApiTokenの失効」「session import」
- `database/control-plane.md`「ApiTokenの発行と寿命」
- `api/read-api.md`「認証と認可」「認可の失敗」
- `infrastructure/environments.md`「接続先」（buildの入力）

## Behavior slices

1. `hf init`は、keychainの`:api-token`の項目それぞれのrefresh tokenのhashを`revoke_api_token_hashes`で送り（100件を超えればログインを始めない）、応答のaccess token、refresh token、2つの有効期限を1つのJSONのobjectとして`<workspace_id>:api-token`に保存する。
2. `hf import`と`hf run --issue`は、access tokenの期限切れと`401`で、`~/.harnessforce/token.lock`の下でrefreshし、再試行する。refreshできなければ「ログインの有効期限が切れました。`hf init`を実行してください」で終わる。
3. releaseのworkflowは、CLIの接続先を`vars.HARNESSFORCE_BUILD_URL`からbuildへ渡す。

## 対象外

- `hf tune`: improvement-loop.mdの「提供の範囲と時期」により、v1のrelease gateの項目1〜10を満たすDelivery PRがすべてmergeされるまで着手しない。
- pluginの`.mcp.json`: apps/webの`/mcp`がまだ無いため、MCP serverのDeliveryで足す。
