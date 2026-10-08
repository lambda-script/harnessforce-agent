---
name: record-run
description: HarnessforceのIssue（ENG-42のような識別子）に取り組む作業で、HarnessforceのMCP serverのtoolを使い、このsessionをRunとして登録し、Plan、Decision、Definition of Doneの充足を記録する。Issueに取り組み始めるとき、Issueを指定されずに変更をcommitする作業を始めるとき、方針を変えるとき、作業を終えるときに使う。
---

# HarnessforceのIssueの作業を記録する

HarnessforceのMCP serverのtoolで、作業をIssueに結び付けて記録する。toolを初めて使うときは、ブラウザでのログインとWorkspaceの選択を求められる。

## 作業の開始時

利用者がIssueを示していなければ、先に下の「Issueを指定されていない場合」に従う。

1. contextにある`harnessforce session_id: <session_id>`の値を`session_id`として渡し、`start_run`でRunを登録する。この行はHarnessforceのpluginがsessionの開始時にcontextへ加える。複数あれば、最後に加えられたものを使う。入力は、Issueの識別子（`issue_identifier`）、`agent`（`claude_code`）、`session_id`とする。作業しているrepository、branch、commitが分かれば併せて渡す。返された`run_id`を終了時まで控えておく。contextにこの行が無い場合は、下の「session IDが無い場合」に従う。
2. `get_issue`で、Issue、Plan、Definition of Doneを確認する。nativeのIssueなら、下の「nativeのIssueの状態」に従う。Planは状態（現行か`proposed`か）で区別されている。
3. 現行のPlanも`proposed`のPlanも無ければ、作業の方針を`record_plan`で記録する。本文はmarkdownで書く。

## 作業の途中

- 方針を変えたとき、または選択肢から選んだときは、`record_decision`で記録する。題（`title`）、決めたこと（`decision`）、理由（`rationale`）を必ず書き、検討した選択肢があれば`alternatives`に書く。

## session IDが変わったとき

- contextの最後の`harnessforce session_id:`の値が、直前の`start_run`に渡した値と異なる（会話をforkしたとき、`/clear`したときなど）場合は、作業を続ける前に新しい値で`start_run`をもう1度呼び、返された`run_id`を以後の`complete_run`に使う。

## 作業の終了時

- `complete_run`に`run_id`と、`get_issue`が返したDefinition of Doneの項目ごとの充足（`item_id`と、満たしたなら`met`、満たしていないなら`unmet`）を渡す。Definition of Doneの項目が無い場合は、項目を渡さない。

## Issueを指定されていない場合

利用者がIssueを示さずに作業を始めたら、Issueを作るかを利用者に尋ねる。Issueを作るのは、利用者が承諾した後だけとする。

1. 次のすべてに当たる場合だけ尋ねる。
   - 利用者がIssueの識別子を示していない。現在のbranch名が`ENG-42`、`eng-42-login`、`gh-45-fix`のような識別子を含み、`get_issue`でそのIssueを解決できたら（`gh-<番号>`は、そのrepositoryの`<owner>/<repo>#<番号>`として渡す）、そのIssueを示されたものとして「作業の開始時」に進み、尋ねない。`not_found`なら識別子が無い場合と同じに扱う。
   - 作業が変更をcommitするものである。調べもの、質問への回答、計画だけの会話では尋ねない。
   - contextに`harnessforce session_id:`の行がある。
   - contextの最後の`harnessforce session_id:`の値ごとに、同じ値で尋ねるのは1回だけとする。利用者が断ったら、同じ値の間は再び尋ねない。forkや`/clear`で値が変わったら、改めて尋ねてよい。
2. 既存のIssueを先に示す。作業の要約から、Issueのtitleに現れそうな語を最大3つ選び、語ごとに`list_issues`を、`q`を`-status:done,canceled {語}`、`sort`を`updated`として1回ずつ呼ぶ。自由文は複数の語ではそのすべてを含むIssueにだけ一致するため、語を分けて呼ぶ。結果を合わせて重複を除き、更新の新しい順に最大5件を候補として示す。利用者が候補を選んだら、Issueを作らずにそのIssueで「作業の開始時」に進む。
3. 候補に当たるものが無ければ、作る案を示す。
   - title: 作業の要約。80文字以内。
   - 説明: 目的と完了の条件の箇条書き。
   - Project: `list_projects`を`q`を`status:active`として呼び、1件ならそれを、2件以上なら利用者に選ばせる。0件ならIssueを作らず、その旨を伝える。
   - titleと説明には、promptの本文、file path、command、secretを写さない。titleは一覧とURLに現れ、説明より広く読まれる。
   - 外部のIssue管理ツールを使うチームには、「Harnessforceにだけ作られ、外部のツールには書き戻されません」と伝える。
4. 利用者が案を承諾した場合だけ、`create_issue`でIssueを作り、返されたidentifierで「作業の開始時」の`start_run`を呼ぶ。利用者が案を直したら、直した値で作る。承諾は会話の中の利用者の明示の返答とする。非対話の実行や利用者のいない自動の実行では、返答を得られないため作らない。
5. 作れない場合と失敗した場合:
   - `create_issue`か、候補を選んだ後の`start_run`が`forbidden`（Viewerのtoken、閲覧のみのWorkspaceの`workspace_read_only`を含む）を返したら、作れない理由をそのまま伝え、同じsession IDでは再び尋ねない。
   - `create_issue`を再試行しない。再試行するとIssueが2件作られうる。timeoutなどで結果が分からなければ、`list_issues`で案のtitleを自由文に検索し、titleが完全に一致し、作成時刻が呼び出しの後のIssueが見つかればそれを使う。見つからなければ、作れなかったことを伝える。
   - `create_issue`が成功して`start_run`だけが失敗したら、作ったIssueのidentifierを伝え、Issueを作り直さない。
6. `create_project`、`create_milestone`、`create_cycle`、`create_objective`を自らの判断で呼ばない。目標日、所属、Priority、Assigneeも自ら変えない。これらは計画の変更であり、利用者が会話の中で明示に指示した場合だけ、指示どおりに呼ぶ。

## nativeのIssueの状態

- nativeのIssue（`get_issue`の`external`が`null`のIssue）で、作業を始めた時点の状態が`backlog`か`unstarted`なら、`start_run`の後に「状態を『進行中』にしますか」と尋ね、承諾した場合だけ`update_issue`で状態を`started`に変える。`update_issue`には、`get_issue`が返したIssueの`version`（`definition_of_done.version`ではない）と、変えない他の属性の現在の値を併せて渡す。
- 作業を終える時点で、利用者が仕事の完了を示していれば、`complete_run`の後に「状態を『完了』にしますか」と尋ね、承諾した場合だけ状態を`done`に変える。Pull Requestを開いただけで、mergeされていない場合は尋ねない。
- 外部由来のIssueの状態は変えない。状態の正本は外部のツールである。GitHub IssuesのIssueでは、利用者がPull Requestの本文を書く際の文面として`Closes #<番号>`を提案してよい。agentがPull RequestとIssueを自ら結び付ける操作の代わりにはしない。
- `update_issue`が`conflict`を返したら、`get_issue`で読み直して伝え、1回だけ尋ね直す。再び`conflict`なら、そのことを伝えて終える。

## session IDが無い場合

- contextに`harnessforce session_id:`の行が無ければ、session IDを推測して渡さず、`start_run`と`complete_run`を呼ばない。`get_issue`、`record_plan`、`record_decision`はRunに依らないため続ける。

## 記録の扱い

- agentが記録したPlan、Decision、充足は`proposed`として保存され、人が承認するまで確定しない。記録したことを、確定したこととして利用者へ伝えない。
