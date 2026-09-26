# 実装計画: CLI の資格情報（`hf init`、`hf otel-headers`、hook の利用者用 key）

**Goal**: `hf init` でブラウザログインして利用者用 IngestKey と ApiToken を発行し、OS の keychain に保存し、Claude Code の user settings を書く。`hf otel-headers` で keychain の key を header として出力する。plugin の hook は `hf otel-headers` 経由で利用者用 key を読み、key の種類ごとの 401 文言と `source=cli` を扱う。

**Canonical spec**: lambda-script/harnessforce#22（`spec/agent-session-registration`）
- `docs/specs/features/correlation.md`（実行環境、接続先、hook の共通の規則、CLI）
- `docs/specs/database/control-plane.md`（IngestKey と ApiToken）
- `docs/specs/architecture/telemetry-pipeline.md`（gate_unavailable の終端）
- `docs/specs/infrastructure/environments.md`（接続先、preview の 503）
- `docs/references/claude-code.md`、`docs/references/nodejs.md`

**Branch**: `feature/cli-credentials`（base `feature/plugin-config-snapshot`）

**依存**: `@napi-rs/keyring`（MIT、3 OS の prebuilt、Linux は `secret-service` に固定できる。`keytar` は archived）。test は fake の keychain を注入し、実際の keychain に触れない。

## 対象外

| 対象外 | 扱う条件 |
|---|---|
| `hf import`、`hf run` | 後続の `feature/cli-import`、`feature/cli-run` |
| plugin の `.mcp.json` を接続先から作る | `feature/plugin-mcp-setup`。本 PR は CLI の既定の接続先だけを build の入力から作る |
| 実 server との結合 | server の endpoint ができた時点で本体の system test |

## spec 外の決定（実装の詳細）

- build の入力の名前は `HARNESSFORCE_BUILD_URL` とし、CLI の build が `dist/build-config.json` に書く。値が無いか scheme の規則を満たさない build は失敗する。
- ブラウザは macOS `open`、Windows `rundll32 url.dll,FileProtocolHandler`、それ以外 `xdg-open` で開き、起動の失敗または 0 以外の終了で URL を stderr へ出す。
- hook は `PATH` の絶対 path の directory だけを探す。
- `hf otel-headers` の失敗は stdout にも stderr にも何も書かない。

## Tasks（各 task は RED → GREEN → commit）

1. **接続先の URL 規則を共有する**: `packages/cli/src/url.ts`（https、または loopback の http）。plugin の `destination.ts` はこれを使う。
2. **keychain の抽象**: `packages/cli/src/credentials/keychain.ts`（`isAvailable`、`get`、`set`、`list`、account 名）と `@napi-rs/keyring` の adapter（module を注入して service、account、Linux の store を test する）。
3. **`hf otel-headers`**: env の `HARNESSFORCE_INGEST_KEY` 優先、`HARNESSFORCE_WORKSPACE_ID` の key、失敗は出力なしで exit 1。`main.ts` を async にして command を振り分ける。
4. **hook の利用者用 key**: `hf` の `PATH` 解決（Windows の `PATHEXT`、`.cmd` の `cmd.exe /d /s /c`、`%` を含む path）、1 秒の上限、出力の検証、失敗時の stderr。KeyKind `user` の 401 文言、`HARNESSFORCE_ISSUE` による `source=cli`。
5. **`hf init` の部品**: PKCE と state、authorization server metadata、loopback（`/callback`、404、5 分）、credentials の要求と応答の分類、user settings の併合。
6. **`hf init` の手順**: 部品をつなぎ、spec の終端の表をすべて test で固定する（mock server とブラウザの fake）。
7. **build の入力**: `HARNESSFORCE_BUILD_URL`、turbo の env、CI。
8. **README**、最終検証（`pnpm check`）、plan の削除。
