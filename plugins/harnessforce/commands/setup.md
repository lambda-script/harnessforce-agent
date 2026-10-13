---
description: Harnessforceのsetup。Node.jsの確認、本文データを送るかの選択、CLIの導入、harnessforce init、過去のsessionの取り込み、利用枠を共有するかの選択、再起動後の最初のイベントの確認までを対話で進める
disable-model-invocation: true
---

# Harnessforceのsetup

次の手順を順に、利用者と対話しながら進める。commandが失敗したら、その出力を利用者へ示し、以降の手順へ進まずに止まる。

## 1. Node.jsを確かめる

最初に`node --version`を実行する。commandが見つからない、またはversionが18未満なら、CLIの導入へ進まずに次の文言をそのまま表示して終わる。

> プラグインのフックにはNode.js 18以上が必要です。Node.jsを導入してからClaude Codeを再起動し、もう一度`/harnessforce:setup`を実行してください

## 2. 再起動後の実行かを確かめる

`harnessforce --version`が成功し、かつこのsessionの環境変数`HARNESSFORCE_WORKSPACE_ID`が空でなければ、`harnessforce init`の後に再起動したsessionである。手順3から8を行わずに手順9へ進む。

## 3. CLIを導入する

次を実行し、続けて`harnessforce --version`で導入できたことを確かめる。

```sh
npm install -g @harnessforce/cli
```

## 4. 本文データを送るかを選ぶ

`harnessforce init`の前に、本文データを送る設定の選択肢を、既定では選ばれない状態で利用者に示す。この時点ではログインが済んでおらず、接続するWorkspaceもそのopt-inの状態も分からないため、opt-inの有無で表示を変えない。

選択肢には次を併せて示す。

- 選ぶと、agentに入力した指示（prompt）の本文がこのWorkspaceへ届き、secretのパターンとメールアドレス・電話番号を`[REDACTED:種類]`に置き換えたうえで保存され、本文データの保持期間（最大30日）で削除される。パターンに一致しない秘密値と個人情報は伏せ字にならず、すべてを検出できるとは限らない。保存した本文は、Workspaceのメンバーの中では送った本人だけが読め、OwnerとAdminも読めない。本人は「自分のやり方」でいつでも自分の本文を削除できる。
- 本文が保存されるのは、端末のこの設定とWorkspaceのopt-inの2つがそろう場合だけ。Workspaceのopt-inを解除すると、それ以降の本文は受信時に破棄され、既存の本文データも読めなくなる。この設定はモデルの応答やツールの入出力を送る設定を有効にしない。
- 選んだ場合は`harnessforce init --send-content`、選ばない場合は`harnessforce init`を実行する（手順5）。この設定はClaude Codeのuser settingsの`env`に書き、project（`.claude/settings.json`）とlocal（`.claude/settings.local.json`）の`env`には書かない。その2つのfileの`env`では本文の変数が無視されるため。
- 選んだ後で止めるときは、user settingsの`env`の`OTEL_LOG_USER_PROMPTS`を`0`にする。止める値はprojectとlocalの`env`でも効く。

選択肢の文言は次をそのまま使う。

> 入力した指示の本文を送って分析に使えます（既定では無効。Workspaceが指示本文をオプトインしている場合だけ有効になります）。有効にすると、エージェントに入力した指示の本文がこのWorkspaceへ届き、保存されます。パターンに一致した秘密値と個人情報は`[REDACTED:種類]`に置き換えますが、すべてを検出できるとは限りません。本文データの保持期間（最大30日）で削除し、Workspaceのメンバーの中では、読めるのは送ったあなただけです。自分のやり方の画面からいつでも削除できます。有効にしますか？
>
> You can send the prompts you type for analysis (off by default; it takes effect only if the workspace has opted in to prompts you typed). If enabled, the prompts you type to the agent are delivered to this workspace and stored. Values that match known patterns for secrets and personal information are replaced with `[REDACTED:kind]`, but not everything can be detected. Content is deleted after the content retention period (at most 30 days), and within the workspace only you can read it. You can delete it at any time from My practices. Enable this?
>
> 本文を送りません（既定）。後から設定できます
>
> Content is not sent (by default). You can enable it later.

## 5. Harnessforceに接続する

手順4の選択に従い、選んだ場合は`harnessforce init --send-content`、選ばない場合は`harnessforce init`を実行する。ブラウザでHarnessforceにログインし、接続するWorkspaceを1つ選ぶよう利用者へ伝える。ブラウザが開かなければ、`harnessforce init`が表示するURLを利用者へ示す。ログインの完了を最大5分待つため、Bashのtimeoutを10分にして実行する。

opt-inしていないWorkspaceでは`harnessforce init --send-content`は本文の設定を書かず、その旨とWorkspaceの設定のデータの保持への案内を表示して終了コード0で終わる。失敗として扱わず、表示された文言をそのまま利用者へ示す。

## 6. 過去のsessionを取り込む

`harnessforce import`を実行し、表示された取り込んだ件数と、取り込まなかったセッションの内訳と案内を、そのまま利用者へ伝える。0件のときも、表示された理由と次の行動を省かない。

## 7. 利用枠を共有するかを選ぶ

`harnessforce init`の後に、`harnessforce usage-limits status`を実行する。表示のWorkspaceのopt-inが「有効」でなければ（「無効」「確認できません」を含む）、利用枠の選択肢を示さず手順8へ進む。「有効」なら、利用枠（Claude Codeの5時間と7日の枠の使用率とリセット時刻）をこのWorkspaceのメンバーと共有する選択肢を、既定では選ばれない状態で利用者に示す。選ばれなければ、何も実行せず手順8へ進む。

選択肢の文言は次をそのまま使う。

> 利用枠を共有できます（既定では共有しません）。共有すると、あなたの名前とともに、あなたの利用枠（5時間・7日などの窓の使用率とリセット時刻だけ）を、このWorkspaceのメンバー全員が見られます。プロンプトなどの本文は送りません。いつでもやめられ、やめると保存済みの値も削除します。メンバーの順位づけには使いません。共有しますか？
>
> You can share your usage limits (not shared by default). If shared, everyone in this workspace can see your usage limits together with your name (only the usage percentage and reset time of each window, such as 5 hours and 7 days). No prompt or other content is sent. You can stop at any time, and stopping deletes the stored values. They are not used to rank members. Share them?
>
> 共有しません（既定）。後から`harnessforce usage-limits on`で設定できます
>
> Not shared (by default). You can set it up later with `harnessforce usage-limits on`.

共有を選んだ場合だけ、利用者自身が同意の文面に答えるため、`!harnessforce usage-limits on`を利用者に入力してもらう。`--yes`は付けず、agentが同意を代行しない。同意の文面に`y`と答えると、既にstatusLineを使っている場合（claude-hudなど）は、そのcommandを包んで表示と終了コードを変えずに残す。Windowsや、組み込めないstatusLineでは、このcommandは何も変えずに理由を表示して0以外で終わる。その表示を利用者へそのまま示し、他の手順は続ける。やめるときは`harnessforce usage-limits off`を案内する。

## 8. 再起動を案内する

次を利用者へ伝えて終わる。

> Claude Codeを再起動すると設定が反映されます。再起動したsessionで、もう一度`/harnessforce:setup`を実行してください。最初のイベントが届いたかを確認します。

## 9. 最初のイベントを確認する

このsessionの開始時に、pluginのhookがsessionをHarnessforceへ送っている。利用者に、ブラウザでHarnessforceのHome（環境変数`HARNESSFORCE_URL`のURL）を開き、最初のRunの待機画面で受信を確認するよう伝える。15分待っても届かなければ、待機画面が示す原因ごとの確認手順に沿って確かめるよう伝える。
