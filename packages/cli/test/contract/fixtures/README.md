# server の応答 fixture

harnessforce（server）が agent へ返す 200/201 の応答の形を、agent の parse に通して固定するための fixture。
agent が期待する形から書いたものではなく、server の実装から写している。server の応答の形を変えたら、この
fixture を更新しないと `server-responses.test.ts` が落ちる（agent が読めなくなる変更を検出する経路）。

写した元（harnessforce の commit `58e305f52`、2026-11-01 時点）:

| file | 要求 | 元 |
|---|---|---|
| `credentials-201.json` | `POST /api/v1/cli/credentials` | `apps/web/src/lib/oauth/cli-credentials-endpoint.ts` の `issueCredentials` |
| `repositories-page-1.json`・`repositories-page-2.json` | `GET /api/v1/repositories` | `apps/web/src/lib/read-api/handlers.ts` の `listRepositories` と `serializePage` |
| `workspace-200.json` | `GET /api/v1/workspace` | `apps/web/src/lib/read-api/handlers.ts` の `getWorkspace` と `serialize.ts` の `serializeCliContentSettings`（`content` は harnessforce PR #2153 の `8c2712271` から） |
| `onboarding-200.json` | `GET /api/v1/onboarding` | `apps/web/src/lib/read-api/serialize.ts` の `serializeOnboarding` |
| `ingest-200.json` | `POST /v1/sessions` ほか汎用 ingest の 7 path | `apps/ingest/src/http/otlp-response.ts` の `elementsAccepted` |

値は実在の Workspace のものではなく、形式だけを合わせたもの。秘密は含まない。
