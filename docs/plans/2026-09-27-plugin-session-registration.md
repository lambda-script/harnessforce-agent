# Plan: plugin の session registration（Delivery 1）

- Branch: `feature/plugin-session-registration`（base: `feature/semconv-foundation`）
- Canonical spec: lambda-script/harnessforce#22（branch `spec/agent-session-registration`）
  - `docs/specs/features/correlation.md`（実行環境、接続先、hook、共通の規則、受入条件）
  - `docs/specs/api/ingest-api.md`（認証、`POST /v1/sessions`、応答）
  - `docs/specs/api/semantic-conventions.md`（Session registration、repositoryの正規化）
  - `docs/specs/database/control-plane.md`（RunRegistration、IngestKey）
  - `docs/specs/infrastructure/environments.md`（接続先、stagingのbuildの出力をlocalのmarketplaceとして登録する）
  - `docs/references/claude-code.md`、`docs/references/nodejs.md`
- 完了時にこのfileを削除する。

## Goal

Claude Code pluginのSessionStartとUserPromptSubmitのhookで、sessionのrepository、branch、commitと最初のprompt IDを`/v1/sessions`へ登録する。どの失敗でもsessionを止めない（常にexit 0）。

## Architecture

- `plugins/harnessforce`をprivateなworkspace member（`harnessforce-plugin`）にする。`packages/*`は公開packageだけを置く契約（release-contract test）のため、そこへは置かない。
- hookの本体は`plugins/harnessforce/src/*.ts`。副作用（env、時計、git、fetch、stdout、stderr）は注入し、unit testではfakeへ置き換える。scratchpadは実fileをtemp directoryで扱う。
- buildは`plugins/harnessforce/dist/marketplace/`にmarketplaceのdirectoryを作る（environments.md「接続先」: stagingの検証者はbuildの出力をlocalのmarketplaceとして登録する）。
  - `scripts/harnessforce-hook.cjs`: ES5とCommonJSだけで書いたentry。Node.jsが18未満なら何も送らずexit 0で終える（correlation.md「実行環境」）。
  - `scripts/harnessforce-hook-main.cjs`: esbuildで依存を同梱した本体（target node18）。
  - `hooks/hooks.json`: exec形式（`command: "node"`、`args: ["${CLAUDE_PLUGIN_ROOT}/scripts/harnessforce-hook.cjs", "<event>"]`）で生成する。
- repositoryに置く`plugins/harnessforce/hooks/hooks.json`は空のままにする。scriptはbuildの出力にしか無いため、repositoryから直接導入したpluginが存在しないscriptを起動しないためである。
- repositoryの正規化は`@harnessforce/semconv`の`normalizeRepository`に置き、hookは`packages/semconv/src`をsourceからbundleする（npm scopeの変更で内部依存名が変わっても壊れないため、package名ではimportしない）。

## 対象外（後続のDelivery）

| 対象外 | 扱う時点 |
| --- | --- |
| config snapshotの送信と、その401 | `feature/plugin-config-snapshot` |
| keychainの利用者用IngestKey（`hf otel-headers`の起動、`HARNESSFORCE_WORKSPACE_ID`）と`HARNESSFORCE_ISSUE`による`source=cli` | `feature/cli-credentials`。この間はWorkspace用のkey（`HARNESSFORCE_INGEST_KEY`）だけを選び、無ければ`no ingest key`で終える |
| buildの入力としての接続先（`.mcp.json`とCLIの既定の接続先） | 接続先を使う最初のDelivery（`.mcp.json`またはCLIの既定値）。hookは`HARNESSFORCE_ENDPOINT`だけを使い、接続先を使わない |
| 一般への配布（公開marketplace、npm） | productionのドメインがenvironments.mdに記録された時点 |

## spec外の実装上の決定

- gitの各呼び出しの上限は1秒とする。
- 生成する`hooks.json`の`timeout`は10秒とする（scriptが止まった場合の保険）。
- 送信は`redirect: "error"`とする。redirect先へkeyを渡さないためであり、結果は送信の失敗として扱う。

## Tasks

各taskはRED（失敗を確認）→ GREEN → commit。重いcommandは`sh <scratchpad>/heavy.sh`経由、turboは`--concurrency=1`。

1. **semconv: `normalizeRepository`**（`packages/semconv/src/repository.ts`、`test/repository.test.ts`）。scheme、userinfo、port、末尾の`.git`と`/`の除去、scp形式、hostの小文字化、`ssh.github.com`→`github.com`、github.comのowner/nameの小文字化、2 segmentにならないURLとlocal path、`file://`は`undefined`。
   - commit: `feat(semconv): add repository normalization shared by agent and server`
2. **SessionStartの登録**（`plugins/harnessforce/{package.json,tsconfig.json,vitest.config.ts,turbo.json,src/{hook,input,destination,scratchpad,vcs}.ts,test/*}`、`pnpm-workspace.yaml`、root `package.json`の`lint:root`、`tests/workspace-contract.test.ts`）
   - `source`が`startup`、`clear`、`fork`、無しのときだけ送る。`resume`、`compact`、その他は送らない。
   - 印`unauthorized-<session_id>`があれば送らない。
   - 送信先の判定を先に行い、無いか不正なら`skipped (invalid endpoint)`。`https:`と、loopbackの`http:`だけを許す。末尾の`/`を1つに正規化して`v1/sessions`を連結する。
   - keyが無ければ`skipped (no ingest key)`。
   - repositoryの外、remoteが無い場合は送らない。remoteは`origin`、無ければ最初のremote。正規化できなければrepositoryを省く。detached HEADではbranchを省く。
   - 送信前に`registration-<session_id>.json`へ保存する。session_idが`[A-Za-z0-9_-]+`でない、または`scratchpad_dir`が絶対pathでない場合は保存しない。
   - 2秒で打ち切る。2xxで完了。401ならstderrとstdoutの`systemMessage`（Workspace用のkeyの文言）、印`unauthorized-<session_id>`を作る。それ以外は`failed (<理由>)`をstderrへ書く。
   - `HARNESSFORCE_ISSUE`があってもWorkspace用のkeyでは`source=cli`を付けない。
   - commit: `feat(plugin): register sessions from the SessionStart hook`
3. **UserPromptSubmitの最初のprompt ID**（`src/hook.ts`、`src/scratchpad.ts`、`test/user-prompt-submit.test.ts`）
   - `prompt_id`、使えるscratchpad、保存した登録があり、印`unauthorized`が無いときだけ、印`first-prompt-sent-<session_id>`を排他的に作れたら、保存した登録に`first_prompt_id`を加えて送る。
   - `/clear`の後の別のsession IDでは、同じscratchpadでも送る。
   - commit: `feat(plugin): add the first prompt id from the UserPromptSubmit hook`
4. **entry、bundle、marketplaceの出力**（`src/entry.cjs`、`src/main.ts`、`build.mjs`、`test/entry.test.ts`、`test/bundle.test.ts`）
   - entryはES5として構文解析でき（acorn `ecmaVersion: 5`）、18未満では本体を読み込まずに`skipped (unsupported node)`を書く。
   - 出力のmarketplaceを子プロセスで起動し、実gitとlocalのmock server（`/v1/sessions`）で登録、401の表示、2秒の打ち切り、repository外の無送信、exit 0を確かめる。
   - commit: `feat(plugin): build the hook bundle into a local marketplace directory`
5. **README**: hookの設定、Node.js 18以上、stagingのbuildの登録手順。
   - commit: `docs: describe plugin session registration hooks`
6. `pnpm check`、review、planの削除。
   - commit: `docs: remove completed plugin session registration plan`
