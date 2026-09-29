---
name: record-run
description: HarnessforceのIssue（ENG-42のような識別子）に取り組む作業で、HarnessforceのMCP serverのtoolを使い、このsessionをRunとして登録し、Plan、Decision、Definition of Doneの充足を記録する。Issueに取り組み始めるとき、方針を変えるとき、作業を終えるときに使う。
---

# HarnessforceのIssueの作業を記録する

HarnessforceのMCP serverのtoolで、作業をIssueに結び付けて記録する。toolを初めて使うときは、ブラウザでのログインとWorkspaceの選択を求められる。

## 作業の開始時

1. contextにある`harnessforce session_id: <session_id>`の値を`session_id`として渡し、`start_run`でRunを登録する。この行はHarnessforceのpluginがsessionの開始時にcontextへ加える。複数あれば、最後に加えられたものを使う。入力は、Issueの識別子（`issue_identifier`）、`agent`（`claude_code`）、`session_id`とする。作業しているrepository、branch、commitが分かれば併せて渡す。返された`run_id`を終了時まで控えておく。contextにこの行が無い場合は、下の「session IDが無い場合」に従う。
2. `get_issue`で、Issue、Plan、Definition of Doneを確認する。Planは状態（現行か`proposed`か）で区別されている。
3. 現行のPlanも`proposed`のPlanも無ければ、作業の方針を`record_plan`で記録する。本文はmarkdownで書く。

## 作業の途中

- 方針を変えたとき、または選択肢から選んだときは、`record_decision`で記録する。題（`title`）、決めたこと（`decision`）、理由（`rationale`）を必ず書き、検討した選択肢があれば`alternatives`に書く。

## session IDが変わったとき

- contextの最後の`harnessforce session_id:`の値が、直前の`start_run`に渡した値と異なる（会話をforkしたとき、`/clear`したときなど）場合は、作業を続ける前に新しい値で`start_run`をもう1度呼び、返された`run_id`を以後の`complete_run`に使う。

## 作業の終了時

- `complete_run`に`run_id`と、`get_issue`が返したDefinition of Doneの項目ごとの充足（`item_id`と、満たしたなら`met`、満たしていないなら`unmet`）を渡す。Definition of Doneの項目が無い場合は、項目を渡さない。

## session IDが無い場合

- contextに`harnessforce session_id:`の行が無ければ、session IDを推測して渡さず、`start_run`と`complete_run`を呼ばない。`get_issue`、`record_plan`、`record_decision`はRunに依らないため続ける。

## 記録の扱い

- agentが記録したPlan、Decision、充足は`proposed`として保存され、人が承認するまで確定しない。記録したことを、確定したこととして利用者へ伝えない。
