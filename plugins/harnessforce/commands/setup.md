---
description: Harnessforceのsetup。Node.jsの確認、CLIの導入、hf init、過去のsessionの取り込み、再起動後の最初のイベントの確認までを対話で進める
disable-model-invocation: true
---

# Harnessforceのsetup

次の手順を順に、利用者と対話しながら進める。commandが失敗したら、その出力を利用者へ示し、以降の手順へ進まずに止まる。

## 1. Node.jsを確かめる

最初に`node --version`を実行する。commandが見つからない、またはversionが18未満なら、CLIの導入へ進まずに次の文言をそのまま表示して終わる。

> pluginのhookにはNode.js 18以上が必要です。Node.jsを導入してからClaude Codeを再起動し、もう一度`/harnessforce:setup`を実行してください

## 2. 再起動後の実行かを確かめる

`hf --version`が成功し、かつこのsessionの環境変数`HARNESSFORCE_WORKSPACE_ID`が空でなければ、`hf init`の後に再起動したsessionである。手順3から6を行わずに手順7へ進む。

## 3. CLIを導入する

次を実行し、続けて`hf --version`で導入できたことを確かめる。

```sh
npm install -g @harnessforce/cli
```

## 4. Harnessforceに接続する

`hf init`を実行する。ブラウザでHarnessforceにログインし、接続するWorkspaceを1つ選ぶよう利用者へ伝える。ブラウザが開かなければ、`hf init`が表示するURLを利用者へ示す。ログインの完了を最大5分待つため、Bashのtimeoutを10分にして実行する。

## 5. 過去のsessionを取り込む

`hf import`を実行し、送信した件数と読み飛ばした件数を利用者へ伝える。

## 6. 再起動を案内する

次を利用者へ伝えて終わる。

> Claude Codeを再起動すると設定が反映されます。再起動したsessionで、もう一度`/harnessforce:setup`を実行してください。最初のイベントが届いたかを確認します。

## 7. 最初のイベントを確認する

このsessionの開始時に、pluginのhookがsessionをHarnessforceへ送っている。利用者に、ブラウザでHarnessforceのHome（環境変数`HARNESSFORCE_URL`のURL）を開き、最初のRunの待機画面で受信を確認するよう伝える。15分待っても届かなければ、待機画面が示す原因ごとの確認手順に沿って確かめるよう伝える。
