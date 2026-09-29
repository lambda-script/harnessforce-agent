---
name: propose-improvements
description: /harnessforce:tuneの分析結果から、人の介入、ループにできる繰り返し、MCP serverの改善の提案を作り、hf tune recordで記録してから表示する。/harnessforce:tuneが「提案を作れます」と判定した対象にだけ使う。ファイルは書き換えない。
---

# 分析結果から改善の提案を作る

`/harnessforce:tune`の`summarize.mjs`が出した「提案の対象」のうち、「提案を作れます」の対象ごとに提案を作る。提案は利用者がそのまま適用できる形にし、記録してから表示する。

## 書き換えない

- 利用者のファイル、設定、repository、managed settingsを書き換えない。Edit、Writeのtool、`git apply`、`git commit`、branchの作成、`gh pr create`を使わない。差分とPull Requestの下書きは表示するだけである。
- 書き込むのは、`hf tune record`が`~/.harnessforce/tune/`へ書く記録だけである。一時fileも作らない。

## 作る条件

`summarize.mjs`の判定が正である。「データ不足」と「未計測のため提案しません」の対象には提案を作らない。判定の条件は次のとおりである。

| 対象 | 提案を作る最小の条件 |
| --- | --- |
| すべて | 分析した範囲に10 session以上ある |
| 人の介入 | その`intervention.kind`が、3 session以上で合計10回以上ある |
| ループにできる繰り返し | その`loop.kind`が、合計3回以上ある |
| MCP server | `configured`のsessionが10以上ある |

- 未計測（`not_measured`）の値を根拠にしない。未計測を0として扱わない。
- ハーネスの構成（skill、rule、agent、command、hook、MCP server、modelのversionごとの成果の差）を対象にした提案は作らない。
- 調べても、利用者がそのまま適用できる変更が見つからなければ、その対象の提案を作らず、理由を1行で伝える。

## 根拠を集める

- 対象の「根拠のsession」の`transcript_path`の記録を、提案に必要な部分だけ読む。人の介入なら、その種類のpromptと、直前のagentの応答を読む。ループなら、一巡の手順（Issueの取得、修正、test、push、Pull Requestの作成など）と、人が介入した時点を読む。MCP serverなら、呼び出しと失敗を読む。
- 適用先の現在の定義（settings、skill、rule、agent、command、hook、`.mcp.json`、`~/.claude.json`の`mcpServers`、CLAUDE.md）を読み、差分を現在の内容に対して作る。

## 形式

提案ごとに次を持たせる。

| 項目 | 内容 |
| --- | --- |
| 対象のカテゴリ | `intervention.kind=<kind>`、`loop.kind=<kind>`、`mcp_server=<識別子>`のいずれか |
| 根拠 | 期間、回数、該当したsessionの時刻と、記録の抜粋。抜粋は端末にだけ表示する |
| 変更の種類 | `permissions`、`hook`、`skill`、`rule`、`agent`、`command`、`loop_prompt`、`mcp_config`、`claude_md`のいずれか |
| 適用先 | 利用者のscope、repositoryのscope、managed settingsのいずれかと、ファイルのpath |
| 変更 | そのまま適用できるunified diff。repositoryのscopeなら、branch名、title、本文、diffからなるPull Requestの下書き。managed settingsなら、Owner/Adminが貼り付ける差分 |
| 期待する効果 | どのカテゴリの値が減るか、どの既存の指標（CIの失敗率、手戻り率、完了Issueあたりのcost）が変わるか |
| 測り方 | 適用で変わるComponentVersion（種類と識別子）と、比較に使う指標 |

変更の種類と、適用で変わるcomponentの対応は次のとおりである。

| 変更の種類 | componentの`kind` | componentの識別子（`id`） | 期待する内容 |
| --- | --- | --- | --- |
| `permissions` | `permissions` | `permissions` | 適用後のsettingsの`permissions`の値全体（`value`） |
| `hook` | `hook` | hookのevent名 | 適用後のsettingsの`hooks`のそのeventの値（`value`） |
| `skill` | `skill` | skillのdirectory名 | 適用後の`SKILL.md`の内容全体（`content`） |
| `rule` | `rule` | `CLAUDE.md`か`rules/<path>` | 適用後のfileの内容全体（`content`） |
| `agent` | `agent` | `agents/`からのpathの`.md`を除き`/`を`:`にした名前 | 適用後のfileの内容全体（`content`） |
| `command` | `command` | `commands/`からのpathの`.md`を除き`/`を`:`にした名前 | 適用後のfileの内容全体（`content`） |
| `loop_prompt` | 書くfileの形式に従い`command`か`skill` | 上の`command`か`skill`と同じ | 適用後のfileの内容全体（`content`） |
| `mcp_config` | `mcp_server`（serverを削除する差分ではcomponentを持たない） | server名 | 適用後のserverの定義（`value`）。削除では適用後のfileの内容全体（`content`） |
| `claude_md` | 無し | 無し | 適用後のCLAUDE.mdの内容全体（`content`） |

componentの`source`は適用先のscope（`user`、`repository`、`local`、`managed`）とする。`.mcp.json`のserverは`repository`、`~/.claude.json`の最上位の`mcpServers`は`user`、その`projects`の下は`local`である。

## 許可を減らす提案

- 権限の確認への応答を減らす提案は、確認を求められたtoolと、その許可の内訳を根拠にする。許可するのは、根拠に現れたtoolとcommandの最小の範囲だけとする（例: `Bash(pnpm test:*)`、`Bash(git status)`、`mcp__github__get_issue`）。
- すべてのコマンドを許可する規則を提案しない。`Bash`、`Bash(*)`、`Bash(:*)`、`*`のような、tool全体やすべてのcommandへの許可、`"defaultMode": "bypassPermissions"`、`--dangerously-skip-permissions`は、どの提案にも含めない。

## ループの提案

- ループにできる繰り返しの提案は、commandかskillの形式のprompt（`loop_prompt`）とし、止める条件を必ず含める。止める条件は、最大の繰り返し回数と、人が確認する時点（例: Pull Requestの作成前、同じ失敗が2回続いたとき）の両方とする。
- promptは、根拠のsessionで人が介入していた時点を、止める条件か、agentが自分で行う手順のどちらかに置き換える。

## 記録してから表示する

提案を表示する前に、提案ごとに`hf tune record`を実行し、stdinへUTF-8のJSONのobjectを1つ渡す。入力はheredocで渡し、fileに書かない。区切りの語は、入力に現れない語にする。

```sh
hf tune record <<'HF_TUNE_RECORD_7f3c'
{"category": "...", "change_type": "...", "scope": "...", "path": "...", "evidence_session_ids": ["..."], "body": "..."}
HF_TUNE_RECORD_7f3c
```

| 項目 | 必須 | 内容 |
| --- | --- | --- |
| `category` | ✓ | 対象のカテゴリ |
| `change_type` | ✓ | 変更の種類 |
| `scope` | ✓ | `user`、`repository`、`local`、`managed`のいずれか |
| `path` | ✓ | 変更が書くfileの絶対path |
| `project_root` | `scope`が`repository`か`local`なら必須 | 適用先のrepositoryのrootの絶対path。それ以外では渡さない |
| `component` | 上の対応表でcomponentを持つ変更なら必須 | `kind`、`source`、`id` |
| `content` | `component`の`kind`が`rule`、`skill`、`agent`、`command`の場合と、componentを持たない場合に必須 | 適用後の`path`のfileの内容全体 |
| `value` | `component`の`kind`が`hook`、`permissions`、`mcp_server`の場合に必須 | 適用後のそのcomponentのsettingsの値（JSON） |
| `evidence_session_ids` | ✓ | 根拠のsessionのsession ID（1件以上）。「根拠のsession」に表示されたものだけを使う |
| `body` | ✓ | 提案の本文（markdown）。根拠、変更、期待する効果、測り方 |

- `hf tune record`が終了コード0で終わった提案だけを表示する。0以外で終わった提案は表示せず、stderrの文言を伝える。
- 同じ提案は同じ入力で記録する。同じ`category`、`change_type`、`path`、適用後の内容なら、何回記録しても1件として数えられる。
- 表示では、対象のカテゴリ、根拠、変更の種類、適用先、変更、期待する効果、測り方を、この順に示す。
