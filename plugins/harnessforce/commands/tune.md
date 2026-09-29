---
description: 自分の過去のsessionを分析し、分析結果と、人の介入、ループにできる繰り返し、MCP serverの改善の提案を表示する。ファイルは書き換えない
argument-hint: "[--all] [--no-send]"
disable-model-invocation: true
---

# 過去のsessionの分析と改善の提案

次の手順を順に進める。この実行では、利用者のファイル、設定、repository、managed settingsを書き換えない。書き込むのは`hf tune`と`hf tune record`が`~/.harnessforce/tune/`へ書くものだけである。

## 1. modelのproviderへ渡ることを伝える

何かを実行する前に、次の文言をそのまま表示する。

> この実行では、提案を作るために、この端末のsessionの記録の一部をagentが読みます。読んだ内容は、ふだんこのagentに使っているmodelのproviderへ、通常のsessionと同じ経路で渡ります。Harnessforceへは渡りません。Harnessforceへ送るのは、公開の規則で数えた分析結果の値だけです。

## 2. 分析する

次を実行する。`hf tune --json`を起動し、分析結果と、提案を作る条件を対象ごとに判定した結果を表示する。送信と未送信の分の再送を含むため、Bashのtimeoutを10分にする。

```sh
node "${CLAUDE_PLUGIN_ROOT}/skills/propose-improvements/scripts/summarize.mjs" $ARGUMENTS
```

- stderrの行は`hf tune`の文言である。省略も言い換えもせずに、すべてそのまま表示する。
- stdoutの分析結果（人の介入、ループにできる繰り返し、MCP server）をそのまま表示する。「未計測」を0と言い換えない。
- 終了コードが0と3以外なら、提案を作らずに終わる。`hf`が見つからない旨の文言が出た場合も同じである。
- 「データ不足のため提案を作りません」の行があれば、その行を表示し、提案を作らずに終わる。

## 3. 提案を作る

「提案の対象」の行をすべて表示する。「データ不足」と「未計測のため提案しません」の行は、あと何が必要かを含めてそのまま表示し、その対象の提案を作らない。

「提案を作れます」の対象について、このpluginの`propose-improvements`のskillの手順に従って提案を作り、`hf tune record`で記録してから表示する。記録が終了コード0で終わらなかった提案は表示しない。

## 4. 適用の仕方を伝える

最後に、提案の適用は利用者が行うことを伝える。手で編集する、`git apply`する、自分のsessionでagentに適用を指示する、のいずれかで適用する。このcommandは適用しない。適用した提案は、次の`/harnessforce:tune`の実行で検出され、件数だけがHarnessforceへ送られる。
