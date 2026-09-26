# 実装計画: `hf import`（過去の session の取り込み）

**Goal**: `hf import` で `~/.claude/projects/<project>/<session>.jsonl` を読み、接続済み repository の session のメタデータだけを `/v1/imports/sessions` へ 100 件ずつ送る。送り終えた session は `~/.harnessforce/import-state.json` に Workspace と送信先の組ごとに記録する。

**Canonical spec**: lambda-script/harnessforce#22（`spec/agent-session-registration`）
- `docs/specs/features/correlation.md`（session import、CLI の宛先の決め方、CLI の Workspace の決め方と送信先の固定、受入条件）
- `docs/specs/api/ingest-api.md`（汎用 ingest API、`rejected` の `reason`）
- `docs/specs/api/read-api.md`（`GET /api/v1/repositories`、cursor の pagination）
- `docs/specs/api/semantic-conventions.md`（Session import、repository の正規化）
- `docs/specs/features/billing.md`（`session_import_days`）
- `docs/references/claude-code.md`（transcript の保存先。schema は非公開）

**Branch**: `feature/cli-session-import`（base `feature/cli-credentials`）

## 対象外

| 対象外 | 扱う条件 |
|---|---|
| `hf run` | 後続の `feature/cli-run` |
| 実 server との結合 | server の endpoint ができた時点で本体の system test。本 PR は local の mock server で検証する |
| `<session>/subagents/*.jsonl` の読み込み | references に記載が無い。記載されたら parser の minor version で加える |

## spec が決めていないこと（PR の spec gap に提案文を書く）

- Read API の pagination の wire 形式と `GET /api/v1/repositories` の要素の形。実装の仮定: `?cursor=<next_cursor>`、応答 `{"data":[{"repository":"<host>/<owner>/<name>"}],"next_cursor":string|null}`。
- CLI が `session_import_days` を知る手段。実装の仮定: `GET /api/v1/workspace` → `{"session_import_days": <1以上の整数>}`。終端は repository 一覧と同じ。
- 範囲の判定の基準時刻（実装: `ended_at` が `now - session_import_days × 24h` 以降）。
- token 数の定義（実装: `usage.input_tokens` と `usage.output_tokens` の合計。cache の token を含めない）。
- 成功時と読み飛ばしの文言。

## spec 外の決定（実装の詳細）

- parser_version は `1.0.0`。transcript の `type` が `user`、`assistant` の行だけを解釈し、JSON の object でない行を「読めない行」、開けないか session を 1 つも取り出せない file を「読めない file」と数える。
- 同じ `message.id` の assistant 行は 1 つの応答として数える（content block ごとに行が分かれ、同じ usage が繰り返されるため）。model `<synthetic>` は数えない。
- repository は `cwd` の git remote（`origin`、無ければ最初の remote）を `normalizeRepository` で正規化する。branch は transcript の最初の `gitBranch`（`HEAD` は省く）。commit は送らない（開始時点の値が記録に無い）。
- 状態 file は `{"version":1,"destinations":{"<workspace_id> <送信先>":{"sessions":["<session_id>"]}}}`、mode 0600、一時 file から rename。

## Tasks（各 task は RED → GREEN → commit）

1. **transcript の parser**: `packages/cli/src/import/transcript.ts`。fixture で、取り出す項目、本文を含まないこと、dedupe、model の多数決と同数、tool の失敗、読み飛ばしの数を固定する。
2. **session の走査と範囲**: `projects/*/*.jsonl` を列挙し、mtime と `ended_at` で範囲外を除く。git で repository を解決する（cwd ごとに 1 回）。
3. **状態 file**: 読み（無い、壊れている）、組ごとの分離、原子的な書き込み。
4. **Read API**: repository 一覧の全ページ、`session_import_days`、401 と失敗の終端。
5. **送信**: 100 件ずつ、401、429/503 と `Retry-After`、その他の失敗、`rejected` の `reason`。
6. **`hf import` の手順**: keychain、Workspace、key、宛先、origin の固定、ApiToken、Read API の base URL をつなぎ、受入条件を mock server で固定する。`main.ts` に command を足す。
7. **README**、最終検証（`pnpm check`）、plan の削除。
