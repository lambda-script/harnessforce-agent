---
name: using-harnessforce
description: Harnessforceのhookが入った環境でsessionを始めたとき、HarnessforceのIssue（ENG-42のような識別子）に取り組む作業を始めるとき、Harnessforceが何を記録し何を収集しないかを尋ねられたときに使う。sessionの開始時にhookがこの本文をcontextへ注入する。
---

# Harnessforceを使う

このsessionにはHarnessforceのhookが入っている。Harnessforceは、人とAIの作業をIssueに結び付けて記録する。次の規則に従う。

## 何を記録するか

- session registration: agent、session ID、repository、branch、commit、開始時刻、最初のprompt ID。
- config snapshot: 利用中の設定の構成（Claude Codeだけ）。
- OTelのテレメトリ: 利用者の設定で送るもの。
- Issueに取り組む作業で`record-run`が記録する、Plan、Decision、Definition of Doneの充足。人が承認するまで確定しない。

## 何を収集しないか

- prompt、応答、toolの入出力、code diffの本文は、利用者が`--send-content`で選び、Workspaceがopt-inした場合だけ届く。既定では収集しない。
- MCPのtoolの入力にも記録にも、これらの本文、secret、環境変数の値を含めない。

## どのhookが何を送るか

- SessionStart: session registrationとconfig snapshot（Codexはsession registrationだけ）。
- UserPromptSubmit: 最初のpromptでの再送（Claude Codeだけ）。
- hookは失敗してもsessionを止めない。送れない状態のときは、hookが警告を1行表示する。警告が出たら利用者に伝える。

## どのskillとtoolをいつ使うか

- IssueのIDを指定された作業、または環境変数`HARNESSFORCE_ISSUE`がある作業は、`record-run`に従い、`start_run`、`get_issue`、`record_plan`、`record_decision`、`complete_run`を使う。skillを読み込めないagentは、同じ順にtoolを呼ぶ。
- `start_run`には、contextの`harnessforce session_id:`の行の値を渡す。複数あれば最後の値を使う。行が無ければ、session IDを推測せず、`start_run`と`complete_run`を呼ばない。
- `/harnessforce:tune`の分析は`propose-improvements`を使う。
- Issueが指定されていない作業では、Runの記録を始めない。

## Red Flags

次の考えが浮かんだら、立ち止まる。

| 考え | 現実 |
| --- | --- |
| 小さな作業なので記録は要らない | Issueが指定された作業は、大きさによらず記録する |
| session IDの行が無いが、推測して`start_run`を呼ぶ | 推測しない。Runがsessionと結び付かなくなる |
| 本文を要約して渡せば記録の役に立つ | 本文はtoolに渡さない。収集しない範囲を超える |
| 警告が出たが、気にしなくてよい | 送れていない。利用者に伝える |

## 優先順位

1. 利用者の指示（CLAUDE.md、AGENTS.md、直接の依頼）。利用者が記録を止めるよう指示したら、Runの記録を止める。
2. この導入文。
3. 既定の動作。

## subagent

親から特定の作業だけを委譲されたsubagentは、この導入文に従ってRunを登録しない。Runの登録は親が行う。
