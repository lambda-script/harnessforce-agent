# semconv基盤とplugin骨組み Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans（またはsuperpowers:subagent-driven-development）でtaskごとに実行する。各stepはcheckbox（`- [ ]`）で追跡する。

**Goal:** `@harnessforce/semconv` 0.1.0（`hf.*`属性の定数、JSON SchemaとTS型）、`@harnessforce/cli`の骨組み（`hf --version`だけ）、Claude Code pluginとmarketplaceの骨組みを1つのpnpm workspaceに置き、CIと、npm scopeができるまで無効にしたrelease workflowを整える。

**Architecture:** pnpm workspaceのmonorepoとする。`packages/semconv`はTypeBoxでschemaを書き、1つの定義からJSON Schema（素のJSONとしてserialize可能）と`Static<>`型を得る。validatorは同梱しない。Cloudflare Workersは文字列からのコード生成を禁じるため、validatorの選択は利用側に任せる。testではAjvで、JSONにしたschemaを検証する。`packages/cli`は依存を持たない`node:util`だけの骨組みとする。pluginは`plugins/harnessforce`に置き、marketplaceは`.claude-plugin/marketplace.json`に置く。npm scopeはroot `package.json`の`config.npmScope`を唯一の変更点とし、`pnpm scope:apply`で各所へ反映する。

**Tech Stack:** Node 22.21.1、pnpm 10.24.0、TypeScript ^6.0.3（NodeNext、ESM）、Vitest ^4.1.10、Biome 2.3.14、@sinclair/typebox ^0.34、Ajv 8.17（testだけ）、@changesets/cli ^2.31、GitHub Actions（ubuntu-24.04、actionはSHAで固定）

**Spec（正本、非公開repository `lambda-script/harnessforce`）:** 承認済みのspec branch `spec/harnessforce-pivot`と`spec/improvement-loop`。lambda-harnessはspec PRを最後にmergeする運用のため、mainへのmerge未完了でも承認済みであれば正本として扱う。
- `docs/specs/api/semantic-conventions.md`（属性、session registration、session import、config snapshot、analysis report、互換性）
- `docs/specs/api/ingest-api.md`（汎用ingest API）
- `docs/specs/architecture/repository-structure.md`（2つのrepository）
- `docs/specs/features/correlation.md`（送信側の構成）、`features/onboarding.md`（marketplaceとpluginの名前）
- `docs/specs/features/improvement-loop.md`（送る値の固定語彙、measurement）
- `docs/specs/database/control-plane.md`（Issueの属性）、`database/telemetry-store.md`（`activity_events`）

**Branch:** `main`から`feature/semconv-foundation`を作る（repository-workflowルールにより`feat/`は使わず、必ず`feature/`とする）。

---

## MEMORY（必ず守る）

- 重いコマンド（`pnpm install`、`pnpm add`、`vitest`、`tsc`、`biome`、`pnpm build`、`pnpm pack`）は同時に1つだけ実行する。並列のsubagentでpnpmを走らせない。
- vitestは必ず`run`モードで実行し、watchを使わない。REDとGREENの確認は単一ファイルで行う（`pnpm exec vitest run <path>`）。
- 全体のcheck（`pnpm check`）はtaskの最後に1回だけ実行する。
- commitのidentityは`^[a-z0-9._-]+@lambdascript\.dev$`に一致すること。Task 1で確認する。
- commit messageの末尾には必ず次のtrailerを付ける。

  ```text
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

- `.env`や`NPM_TOKEN`の値をcommitしない。このDeliveryは実際のpublishを行わない。

## File map

```text
.claude-plugin/marketplace.json                marketplace（name: harnessforce-agent）
.changeset/config.json                         changesets
.github/workflows/ci.yml                       lint / typecheck / test / build
.github/workflows/release.yml                  version PR + publish（vars.NPM_PUBLISH_ENABLEDで無効）
.gitignore  .node-version  biome.json  package.json  pnpm-workspace.yaml
tsconfig.json  vitest.config.ts  README.md（Releasing節を追記）
docs/plans/2026-09-26-semconv-foundation.md    本plan（完了時に削除）
plugins/harnessforce/.claude-plugin/plugin.json
plugins/harnessforce/hooks/hooks.json          空のhooks
packages/semconv/
  package.json  tsconfig.build.json
  src/index.ts  src/attributes.ts  src/schemas/common.ts
  src/schemas/session-registration.ts  src/schemas/session-import.ts
  src/schemas/config-snapshot.ts  src/schemas/analysis-report.ts
  src/schemas/ingest-items.ts
  test/support/validator.ts  test/support/fixtures.ts
  test/attributes.test.ts  test/common.test.ts  test/session-registration.test.ts
  test/session-import.test.ts  test/config-snapshot.test.ts
  test/analysis-report.test.ts  test/ingest-items.test.ts  test/index.test.ts
packages/cli/
  package.json  tsconfig.build.json  src/main.ts  src/bin.ts  test/main.test.ts
scripts/set-npm-scope.mjs  scripts/verify-published.mjs
tests/plugin.test.ts  tests/release-contract.test.ts  tests/set-npm-scope.test.ts
tests/verify-published.test.ts
```

## Out of scope（別のDeliveryで扱う）

次の項目は、観測可能な条件「**このDeliveryがmainへmergeされた**」を満たした時点で、それぞれのDelivery planを起こす。

| 項目 | 正本 |
| --- | --- |
| SessionStartとUserPromptSubmitのhookの振る舞い（`/v1/sessions`への登録、config snapshotの送信、fail-open、2秒の上限） | correlation.md「hook」 |
| config snapshot IDの正規化とhash関数 | semantic-conventions.md「Config snapshot」 |
| `hf init`、`hf import`、`hf run`、`hf tune`（`publish`を含む） | correlation.md「CLI」「session import」、improvement-loop.md |
| MCP serverの宣言（`.mcp.json`）、skill、`/harnessforce:setup`、`/harnessforce:tune` | correlation.md「MCP」 |
| secretのパターンの定義 | privacy-and-retention.md「Redaction」 |
| 分析の規則、`continue`の語彙リスト、カタログ | improvement-loop.md「構成」「カタログ」 |
| 本体（非公開）での`@harnessforce/semconv`の採用 | repository-structure.md |

実際のnpm publishは、別の観測可能な条件「**npmjsで`config.npmScope`のorganizationが作成された**」を満たした時点で、README「Releasing」の手順で有効にする。

---

### Task 1: 前提の確認、branch、workspaceの土台

**Files:** Create `package.json`, `pnpm-workspace.yaml`, `.node-version`, `.gitignore`, `tsconfig.json`, `biome.json`, `vitest.config.ts`, `docs/plans/2026-09-26-semconv-foundation.md`

- [ ] **Step 1: Spec branchの承認とcommitのidentityを確認する**

```bash
gh pr list -R lambda-script/harnessforce --head spec/harnessforce-pivot --json number,title,reviewDecision
gh pr list -R lambda-script/harnessforce --head spec/improvement-loop --json number,title,reviewDecision
git -C /Users/maturu/ghq/github.com/lambda-script/harnessforce-agent config user.email | grep -Eq '^[a-z0-9._-]+@lambdascript\.dev$' && echo IDENTITY_OK
```

Expected: 両branchのSpec Review PRが`reviewDecision: "APPROVED"`、`IDENTITY_OK`。lambda-harnessはspec PRを最後にmergeするため、mainへのmerge済みであることは前提にしない。どちらかが承認済みでなければ、ここで作業を止めて報告する。identityが一致しなければ、`git config user.email <local>@lambdascript.dev`でrepository単位に設定する。

- [ ] **Step 2: branchを作る**

```bash
cd /Users/maturu/ghq/github.com/lambda-script/harnessforce-agent
git switch main && git pull --ff-only && git switch -c feature/semconv-foundation
```

- [ ] **Step 3: rootのファイルを書く**

`package.json`:

```json
{
  "name": "harnessforce-agent",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.24.0",
  "engines": { "node": ">=22.21.1" },
  "config": { "npmScope": "@harnessforce" },
  "scripts": {
    "lint": "biome check .",
    "format": "biome format --write .",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run",
    "build": "pnpm -r --filter \"./packages/*\" run build",
    "check": "pnpm lint && pnpm typecheck && pnpm test && pnpm build",
    "scope:apply": "node scripts/set-npm-scope.mjs",
    "version-packages": "changeset version",
    "release": "pnpm build && changeset publish"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - packages/*
```

`.node-version`: `22.21.1`

`.gitignore`:

```text
node_modules/
dist/
coverage/
*.tsbuildinfo
*.tgz
.env
```

`tsconfig.json`（typecheck専用。各packageの`tsconfig.build.json`がemitする）:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["packages/*/src", "packages/*/test", "tests", "vitest.config.ts"]
}
```

`biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.3.14/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "includes": ["**", "!!**/dist"] },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "formatter": { "enabled": true }
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["packages/*/test/**/*.test.ts", "tests/**/*.test.ts"] },
});
```

- [ ] **Step 4: dev依存を入れてlintを通す**

```bash
pnpm add -Dw typescript@^6.0.3 vitest@^4.1.10 @types/node@^22 ajv@^8.17.1 ajv-formats@^3.0.1
pnpm add -Dw --save-exact @biomejs/biome@2.3.14
pnpm lint
```

Expected: `Checked N files ... No fixes applied`（error 0）

- [ ] **Step 5: commitする**（本planも含める）

```bash
git add -A && git commit -m "chore: set up pnpm workspace with typescript, vitest and biome" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: semconv packageと`hf.*`属性の定数

**Files:** Create `packages/semconv/package.json`, `packages/semconv/tsconfig.build.json`, `packages/semconv/test/attributes.test.ts`, `packages/semconv/src/attributes.ts`

- [ ] **Step 1: packageの設定を置く**

`packages/semconv/package.json`:

```json
{
  "name": "@harnessforce/semconv",
  "version": "0.1.0",
  "description": "Harnessforce semantic conventions: hf.* attributes and ingest JSON Schemas",
  "license": "Apache-2.0",
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist"],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/lambda-script/harnessforce-agent.git",
    "directory": "packages/semconv"
  },
  "publishConfig": { "access": "public", "provenance": true },
  "scripts": { "build": "tsc -p tsconfig.build.json" }
}
```

`packages/semconv/tsconfig.build.json`（declarationは`tsc`でsource treeに沿って生成し、bundleしない）:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": { "noEmit": false, "rootDir": "src", "outDir": "dist", "declaration": true, "sourceMap": true },
  "include": ["src"]
}
```

- [ ] **Step 2: failing testを書く**

`packages/semconv/test/attributes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ATTR, EXECUTION_ACTOR_TYPES, EXECUTION_MODES } from "../src/attributes.js";

describe("hf.* attributes", () => {
  it("exposes every attribute defined in semantic conventions", () => {
    expect(Object.values(ATTR).sort()).toEqual(
      [
        "hf.workspace.id", "hf.project.id", "hf.project.key", "hf.milestone.id", "hf.cycle.id",
        "hf.issue.id", "hf.issue.identifier", "hf.plan.id", "hf.plan.version",
        "hf.agent.config_version", "hf.execution.mode", "hf.execution.actor_type",
        "hf.execution.actor_id", "hf.vcs.repository", "hf.vcs.branch", "hf.vcs.commit",
        "hf.sdk.name", "hf.sdk.version",
      ].sort(),
    );
  });

  it("keeps every name inside the hf.* namespace", () => {
    for (const name of Object.values(ATTR)) expect(name).toMatch(/^hf\.[a-z_]+(\.[a-z_]+)+$/);
  });

  it("fixes the execution vocabularies", () => {
    expect(EXECUTION_MODES).toEqual(["human", "ai", "hybrid"]);
    expect(EXECUTION_ACTOR_TYPES).toEqual(["user", "agent", "integration", "system"]);
  });
});
```

- [ ] **Step 3: REDを確認する**

```bash
pnpm exec vitest run packages/semconv/test/attributes.test.ts
```

Expected: FAIL `Cannot find module '../src/attributes.js'`

- [ ] **Step 4: 実装する**

`packages/semconv/src/attributes.ts`:

```ts
export const ATTR = {
  workspaceId: "hf.workspace.id",
  projectId: "hf.project.id",
  projectKey: "hf.project.key",
  milestoneId: "hf.milestone.id",
  cycleId: "hf.cycle.id",
  issueId: "hf.issue.id",
  issueIdentifier: "hf.issue.identifier",
  planId: "hf.plan.id",
  planVersion: "hf.plan.version",
  agentConfigVersion: "hf.agent.config_version",
  executionMode: "hf.execution.mode",
  executionActorType: "hf.execution.actor_type",
  executionActorId: "hf.execution.actor_id",
  vcsRepository: "hf.vcs.repository",
  vcsBranch: "hf.vcs.branch",
  vcsCommit: "hf.vcs.commit",
  sdkName: "hf.sdk.name",
  sdkVersion: "hf.sdk.version",
} as const;

export type AttributeName = (typeof ATTR)[keyof typeof ATTR];

export const EXECUTION_MODES = ["human", "ai", "hybrid"] as const;
export const EXECUTION_ACTOR_TYPES = ["user", "agent", "integration", "system"] as const;
```

- [ ] **Step 5: GREENを確認してcommitする**

```bash
pnpm exec vitest run packages/semconv/test/attributes.test.ts
```

Expected: `3 passed`

```bash
git add -A && git commit -m "feat(semconv): add hf.* attribute constants" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 共通の型（瞬間、hash、repository、version）とtest用validator

**Files:** Create `packages/semconv/test/support/validator.ts`, `packages/semconv/test/common.test.ts`, `packages/semconv/src/schemas/common.ts`

- [ ] **Step 1: typeboxを入れる**

```bash
pnpm --filter @harnessforce/semconv add @sinclair/typebox@^0.34.0
```

- [ ] **Step 2: validatorのhelperを書く**

testでは、利用側と同じ条件で検証するため、schemaを一度JSONにしてから検証する。

`packages/semconv/test/support/validator.ts`:

```ts
import { Ajv } from "ajv";
import { fullFormats } from "ajv-formats/dist/formats.js";

export function compile(schema: unknown) {
  const ajv = new Ajv({ strict: true, allErrors: true });
  ajv.addFormat("date-time", fullFormats["date-time"]);
  ajv.addFormat("date", fullFormats.date);
  const validate = ajv.compile(JSON.parse(JSON.stringify(schema)));
  return (value: unknown) => validate(value);
}
```

- [ ] **Step 3: failing testを書く**

`packages/semconv/test/common.test.ts`:

```ts
import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { CalendarDate, CommitSha, Instant, RepositorySlug, SemVer, Sha256Hex, Token } from "../src/schemas/common.js";
import { compile } from "./support/validator.js";

const one = (schema: unknown) => compile(Type.Object({ v: schema as never }, { additionalProperties: false }));

describe("Instant", () => {
  const check = one(Instant);
  it.each(["2026-09-26T01:02:03Z", "2026-09-26T10:02:03.123+09:00"])("accepts %s", (v) =>
    expect(check({ v })).toBe(true),
  );
  it.each(["2026-09-26T01:02:03", "2026-09-26 01:02:03Z", "2026-13-01T00:00:00Z", "2026-09-26"])(
    "rejects offset-less or invalid %s",
    (v) => expect(check({ v })).toBe(false),
  );
});

describe("scalar formats", () => {
  it("CalendarDate keeps YYYY-MM-DD", () => {
    expect(one(CalendarDate)({ v: "2026-09-26" })).toBe(true);
    expect(one(CalendarDate)({ v: "2026-09-26T00:00:00Z" })).toBe(false);
  });
  it("RepositorySlug is host/owner/name", () => {
    expect(one(RepositorySlug)({ v: "github.com/acme/web" })).toBe(true);
    expect(one(RepositorySlug)({ v: "lambda-script/harnessforce-agent" })).toBe(false);
  });
  it("CommitSha accepts SHA-1 and SHA-256 hex", () => {
    expect(one(CommitSha)({ v: "a".repeat(40) })).toBe(true);
    expect(one(CommitSha)({ v: "a".repeat(64) })).toBe(true);
    expect(one(CommitSha)({ v: "main" })).toBe(false);
  });
  it("Sha256Hex is lowercase 64 hex", () => {
    expect(one(Sha256Hex)({ v: "0".repeat(64) })).toBe(true);
    expect(one(Sha256Hex)({ v: "A".repeat(64) })).toBe(false);
  });
  it("SemVer", () => {
    expect(one(SemVer)({ v: "1.2.3" })).toBe(true);
    expect(one(SemVer)({ v: "v1" })).toBe(false);
  });
  it("Token rejects whitespace so no free text can pass", () => {
    expect(one(Token())({ v: "eng-42-login" })).toBe(true);
    expect(one(Token())({ v: "fix the login bug" })).toBe(false);
    expect(one(Token())({ v: "" })).toBe(false);
  });
});
```

- [ ] **Step 4: REDを確認する**

```bash
pnpm exec vitest run packages/semconv/test/common.test.ts
```

Expected: FAIL `Cannot find module '../src/schemas/common.js'`

- [ ] **Step 5: 実装する**

`packages/semconv/src/schemas/common.ts`:

```ts
import { Type } from "@sinclair/typebox";

// APIはoffsetの無い日時を受け付けない。format(date-time)だけでは実装によりoffsetが任意になるため、patternでも固定する。
const INSTANT_PATTERN = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})$";

// 互換性の単位はmajor（semantic-conventions.md「互換性」）。$idにはmajorだけを含める。
export const SEMCONV_MAJOR = 0;
export const schemaId = (name: string) => `urn:harnessforce:semconv:${SEMCONV_MAJOR}:${name}`;

export const Instant = Type.String({ format: "date-time", pattern: INSTANT_PATTERN });
export const CalendarDate = Type.String({ format: "date", pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
export const Sha256Hex = Type.String({ pattern: "^[0-9a-f]{64}$" });
export const CommitSha = Type.String({ pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$" });
// <host>/<owner>/<name>（semantic-conventions.md「repositoryの正規化」）。owner/nameだけの2segmentは拒否する。
export const RepositorySlug = Type.String({ pattern: "^[a-z0-9.-]+/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$" });
export const SemVer = Type.String({ pattern: "^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$" });
export const Token = (maxLength = 256) => Type.String({ minLength: 1, maxLength, pattern: "^\\S+$" });
export const Count = Type.Integer({ minimum: 0 });
export const Agent = Type.Union([Type.Literal("claude_code"), Type.Literal("codex")]);
export const closed = { additionalProperties: false } as const;
```

- [ ] **Step 6: GREENを確認してcommitする**

```bash
pnpm exec vitest run packages/semconv/test/common.test.ts
```

Expected: 全件 passed

```bash
git add -A && git commit -m "feat(semconv): add shared schema primitives with offset-required instants" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: session registration

**Files:** Create `packages/semconv/test/support/fixtures.ts`, `packages/semconv/test/session-registration.test.ts`, `packages/semconv/src/schemas/session-registration.ts`

- [ ] **Step 1: fixtureとfailing testを書く**

fixtureはspecの例（`ENG-42`、branch `eng-42-login`）を使う。

`packages/semconv/test/support/fixtures.ts`（以降のtaskで追記していく）:

```ts
export const sessionRegistration = {
  agent: "claude_code",
  session_id: "0b4c6c1e-6d7a-4a51-9f39-2f0e7f3a9c10",
  first_prompt_id: "5d2f0c3e-1111-4c7a-8e21-1f2a3b4c5d6e",
  repository: "github.com/acme/web",
  branch: "eng-42-login",
  commit: "3f786850e387550fdab836ed7e6dc881de23001b",
  issue_identifier: "ENG-42",
  source: "cli",
  started_at: "2026-09-26T09:00:00+09:00",
};
```

`packages/semconv/test/session-registration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SessionRegistrationSchema } from "../src/schemas/session-registration.js";
import { sessionRegistration } from "./support/fixtures.js";
import { compile } from "./support/validator.js";

const check = compile(SessionRegistrationSchema);

describe("session registration", () => {
  it("accepts the full example", () => expect(check(sessionRegistration)).toBe(true));

  it("accepts the minimal hook registration (optional fields omitted)", () => {
    const { first_prompt_id, repository, branch, commit, issue_identifier, ...minimal } = sessionRegistration;
    expect(check({ ...minimal, source: "hook" })).toBe(true);
  });

  it.each([
    ["offset-less started_at", { started_at: "2026-09-26T09:00:00" }],
    ["unknown source", { source: "webhook" }],
    ["unknown agent", { agent: "cursor" }],
    ["repository without host", { repository: "acme/web" }],
    ["unknown field", { prompt: "please fix login" }],
  ])("rejects %s", (_, patch) => expect(check({ ...sessionRegistration, ...patch })).toBe(false));
});
```

- [ ] **Step 2: REDを確認する**

```bash
pnpm exec vitest run packages/semconv/test/session-registration.test.ts
```

Expected: FAIL（moduleが無い）

- [ ] **Step 3: 実装する**

`packages/semconv/src/schemas/session-registration.ts`:

```ts
import { type Static, Type } from "@sinclair/typebox";
import { Agent, closed, CommitSha, Instant, RepositorySlug, schemaId, Token } from "./common.js";

export const REGISTRATION_SOURCES = ["hook", "cli", "mcp", "import"] as const;

export const registrationProperties = {
  agent: Agent,
  session_id: Token(),
  first_prompt_id: Type.Optional(Token()),
  repository: Type.Optional(RepositorySlug),
  branch: Type.Optional(Token()),
  commit: Type.Optional(CommitSha),
  issue_identifier: Type.Optional(Token(64)),
  source: Type.Union(REGISTRATION_SOURCES.map((s) => Type.Literal(s))),
  started_at: Instant,
};

export const SessionRegistrationSchema = Type.Object(registrationProperties, {
  $id: schemaId("session-registration"),
  ...closed,
});
export type SessionRegistration = Static<typeof SessionRegistrationSchema>;
```

- [ ] **Step 4: GREENを確認してcommitする**

```bash
pnpm exec vitest run packages/semconv/test/session-registration.test.ts
```

Expected: `7 passed`

```bash
git add -A && git commit -m "feat(semconv): add session registration schema" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: session import

**Files:** Create `packages/semconv/test/session-import.test.ts`, `packages/semconv/src/schemas/session-import.ts`; Modify `packages/semconv/test/support/fixtures.ts`

- [ ] **Step 1: fixtureとfailing testを書く**

`fixtures.ts`に追記する:

```ts
export const sessionImport = {
  ...sessionRegistration,
  issue_identifier: undefined,
  source: "import",
  ended_at: "2026-09-26T01:30:00Z",
  model: "claude-opus-4-1",
  input_tokens: 120000,
  output_tokens: 8000,
  tool_calls: [
    { tool: "Bash", calls: 12, failures: 1 },
    { tool: "Edit", calls: 5, failures: 0 },
  ],
  parser_version: "0.1.0",
};
delete (sessionImport as Record<string, unknown>).issue_identifier;
```

`packages/semconv/test/session-import.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SessionImportSchema } from "../src/schemas/session-import.js";
import { sessionImport } from "./support/fixtures.js";
import { compile } from "./support/validator.js";

const check = compile(SessionImportSchema);

describe("session import", () => {
  it("accepts the example", () => expect(check(sessionImport)).toBe(true));

  it.each([
    ["offset-less ended_at", { ended_at: "2026-09-26T01:30:00" }],
    ["a source other than import", { source: "hook" }],
    ["negative tokens", { input_tokens: -1 }],
    ["prompt body", { first_prompt: "fix the login" }],
    ["free-text tool name", { tool_calls: [{ tool: "rm -rf /", calls: 1, failures: 0 }] }],
    ["tool output", { tool_calls: [{ tool: "Bash", calls: 1, failures: 0, output: "..." }] }],
  ])("rejects %s", (_, patch) => expect(check({ ...sessionImport, ...patch })).toBe(false));

  it("requires parser_version", () => {
    const { parser_version, ...rest } = sessionImport;
    expect(check(rest)).toBe(false);
  });
});
```

- [ ] **Step 2: REDを確認する**

```bash
pnpm exec vitest run packages/semconv/test/session-import.test.ts
```

Expected: FAIL

- [ ] **Step 3: 実装する**

`packages/semconv/src/schemas/session-import.ts`:

```ts
import { type Static, Type } from "@sinclair/typebox";
import { closed, Count, Instant, schemaId, SemVer, Token } from "./common.js";
import { registrationProperties } from "./session-registration.js";

const ToolCallSummary = Type.Object({ tool: Token(128), calls: Count, failures: Count }, closed);

export const SessionImportSchema = Type.Object(
  {
    ...registrationProperties,
    source: Type.Literal("import"),
    ended_at: Instant,
    model: Token(128),
    input_tokens: Count,
    output_tokens: Count,
    tool_calls: Type.Array(ToolCallSummary),
    parser_version: SemVer,
  },
  { $id: schemaId("session-import"), ...closed },
);
export type SessionImport = Static<typeof SessionImportSchema>;
```

- [ ] **Step 4: GREENを確認してcommitする**

```bash
pnpm exec vitest run packages/semconv/test/session-import.test.ts
```

Expected: `8 passed`

```bash
git add -A && git commit -m "feat(semconv): add session import schema" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: config snapshot

**Files:** Create `packages/semconv/test/config-snapshot.test.ts`, `packages/semconv/src/schemas/config-snapshot.ts`; Modify `fixtures.ts`

項目はspecの表のとおり`agent`、`session_id`、`components`とする（`source`はcomponentごとに持ち、トップレベルには置かない）。IDの正規化とhashはhookのDeliveryで扱う（Out of scope）。

- [ ] **Step 1: fixtureとfailing testを書く**

`fixtures.ts`に追記する:

```ts
export const configSnapshot = {
  agent: "claude_code",
  session_id: sessionRegistration.session_id,
  components: [
    { kind: "skill", id: "tdd-workflow", version: "1.2.0", source: "repository", hash: "a".repeat(64) },
    { kind: "permissions", id: "project", source: "repository", hash: "b".repeat(64) },
    { kind: "mcp_server", id: "harnessforce", source: "user", hash: "c".repeat(64) },
  ],
};
```

`packages/semconv/test/config-snapshot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COMPONENT_KINDS, ConfigSnapshotSchema } from "../src/schemas/config-snapshot.js";
import { configSnapshot } from "./support/fixtures.js";
import { compile } from "./support/validator.js";

const check = compile(ConfigSnapshotSchema);
const withComponent = (c: object) => ({ ...configSnapshot, components: [c] });

describe("config snapshot", () => {
  it("accepts the example", () => expect(check(configSnapshot)).toBe(true));

  it("fixes the component kinds", () =>
    expect(COMPONENT_KINDS).toEqual([
      "skill", "rule", "agent", "command", "hook", "permissions", "mcp_server", "model", "workflow",
    ]));

  it.each([
    ["unknown kind", withComponent({ kind: "plugin", id: "x", source: "repository", hash: "a".repeat(64) })],
    ["file body instead of hash", withComponent({ kind: "rule", id: "x", source: "repository", hash: "a".repeat(64), body: "# rule" })],
    ["non-hex hash", withComponent({ kind: "rule", id: "x", source: "repository", hash: "not-a-hash" })],
    ["unknown component source", withComponent({ kind: "rule", id: "x", source: "team", hash: "a".repeat(64) })],
    ["missing component source", withComponent({ kind: "rule", id: "x", hash: "a".repeat(64) })],
    ["empty components", { ...configSnapshot, components: [] }],
  ])("rejects %s", (_, value) => expect(check(value)).toBe(false));
});
```

- [ ] **Step 2: REDを確認する**

```bash
pnpm exec vitest run packages/semconv/test/config-snapshot.test.ts
```

Expected: FAIL

- [ ] **Step 3: 実装する**

`packages/semconv/src/schemas/config-snapshot.ts`:

```ts
import { type Static, Type } from "@sinclair/typebox";
import { Agent, closed, schemaId, Sha256Hex, Token } from "./common.js";

export const COMPONENT_KINDS = [
  "skill", "rule", "agent", "command", "hook", "permissions", "mcp_server", "model", "workflow",
] as const;
// Claude Codeのsettingsのscopeに対応する収集元（managed/user/repository/local）とplugin。
export const CONFIG_SOURCES = ["managed", "user", "repository", "local", "plugin"] as const;

const Component = Type.Object(
  {
    kind: Type.Union(COMPONENT_KINDS.map((k) => Type.Literal(k))),
    id: Token(),
    // permissionsやmodelはversionを持たないため任意とする。
    version: Type.Optional(Token(64)),
    hash: Sha256Hex,
    source: Type.Union(CONFIG_SOURCES.map((s) => Type.Literal(s))),
  },
  closed,
);

export const ConfigSnapshotSchema = Type.Object(
  {
    // 構成を収集したsession。RunとConfigSnapshotはこのagent/session_idで結ぶ。
    agent: Agent,
    session_id: Token(),
    components: Type.Array(Component, { minItems: 1 }),
  },
  { $id: schemaId("config-snapshot"), ...closed },
);
export type ConfigSnapshot = Static<typeof ConfigSnapshotSchema>;
```

- [ ] **Step 4: GREENを確認してcommitする**

```bash
pnpm exec vitest run packages/semconv/test/config-snapshot.test.ts
```

Expected: `8 passed`

```bash
git add -A && git commit -m "feat(semconv): add config snapshot schema" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: analysis report（固定語彙、自由記述の拒否）

**Files:** Create `packages/semconv/test/analysis-report.test.ts`, `packages/semconv/src/schemas/analysis-report.ts`; Modify `fixtures.ts`

設計: `kind`ごとの値は、語彙をkeyにしたobjectで表す。全kindを必須にし、未知のkeyを拒否する。こうすると重複と欠落が構造上起こらず、「送らなかった」と「0」を取り違えない。`not_measured`の数値は`null`に固定する（improvement-loop.md「`not_measured`の値は0として扱わない」）。

- [ ] **Step 1: fixtureとfailing testを書く**

`fixtures.ts`に追記する:

```ts
const measuredIntervention = { measurement: "measured", count: 3, wait_seconds_median: 42.5 };
const notMeasured = { measurement: "not_measured", count: null, wait_seconds_median: null };
const loop = { measurement: "measured", occurrences: 1, interventions: 2, duration_seconds_median: 600 };
const zeroProposal = { shown: 0, applied_detected: 0 };

export const analysisReport = {
  agent: "claude_code",
  session_id: sessionRegistration.session_id,
  first_prompt_id: sessionRegistration.first_prompt_id,
  started_at: "2026-09-26T00:00:00Z",
  analyzer_version: "0.1.0",
  parser_version: "0.1.0",
  interventions: {
    approval: notMeasured, continue: measuredIntervention, ci_relay: measuredIntervention,
    review_relay: measuredIntervention, answer: notMeasured, other: measuredIntervention,
  },
  loops: {
    issue_to_pr: loop, ci_fix: loop, review_response: loop, test_fix: loop, lint_fix: loop,
    dependency_update: {
      measurement: "not_measured", occurrences: null, interventions: null, duration_seconds_median: null,
    },
  },
  mcp_servers: [
    { server: "harnessforce", calls: 4, failures: null, configured: true, measurement: "measured", failures_measurement: "not_measured" },
    { server: "unlisted", calls: 1, failures: 0, configured: false, measurement: "measured", failures_measurement: "measured" },
  ],
  proposals: {
    permissions: { shown: 1, applied_detected: 0 }, hook: zeroProposal, skill: zeroProposal,
    rule: zeroProposal, agent: zeroProposal, command: zeroProposal, loop_prompt: zeroProposal,
    mcp_config: zeroProposal, claude_md: zeroProposal,
  },
  records_skipped: 2,
};
```

`packages/semconv/test/analysis-report.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AnalysisReportSchema } from "../src/schemas/analysis-report.js";
import { analysisReport as r } from "./support/fixtures.js";
import { compile } from "./support/validator.js";

const check = compile(AnalysisReportSchema);

describe("analysis report", () => {
  it("accepts the example", () => expect(check(r)).toBe(true));

  it.each([
    ["offset-less started_at", { ...r, started_at: "2026-09-26T00:00:00" }],
    ["unknown intervention kind", { ...r, interventions: { ...r.interventions, praise: r.interventions.other } }],
    ["missing intervention kind", { ...r, interventions: { ...r.interventions, approval: undefined } }],
    ["unknown loop kind", { ...r, loops: { ...r.loops, deploy: r.loops.ci_fix } }],
    ["unknown proposal kind", { ...r, proposals: { ...r.proposals, readme: { shown: 1, applied_detected: 0 } } }],
    ["unknown measurement", { ...r, interventions: { ...r.interventions, other: { ...r.interventions.other, measurement: "partial" } } }],
    ["not_measured reported as 0", { ...r, interventions: { ...r.interventions, approval: { measurement: "not_measured", count: 0, wait_seconds_median: null } } }],
    ["measured without a count", { ...r, interventions: { ...r.interventions, other: { measurement: "measured", count: null, wait_seconds_median: null } } }],
    ["free-text top-level field", { ...r, summary: "user keeps saying continue" }],
    ["free-text inside a category", { ...r, loops: { ...r.loops, ci_fix: { ...r.loops.ci_fix, note: "flaky test" } } }],
    ["free-text server identifier", { ...r, mcp_servers: [{ ...r.mcp_servers[1], server: "my server\nsecret" }] }],
    ["failures reported while not measured", { ...r, mcp_servers: [{ ...r.mcp_servers[0], failures: 0 }] }],
  ])("rejects %s", (_, value) => expect(check(JSON.parse(JSON.stringify(value)))).toBe(false));
});
```

- [ ] **Step 2: REDを確認する**

```bash
pnpm exec vitest run packages/semconv/test/analysis-report.test.ts
```

Expected: FAIL

- [ ] **Step 3: 実装する**

`packages/semconv/src/schemas/analysis-report.ts`:

```ts
import { type Static, type TSchema, Type } from "@sinclair/typebox";
import { Agent, closed, Count, Instant, schemaId, SemVer, Token } from "./common.js";

export const INTERVENTION_KINDS = ["approval", "continue", "ci_relay", "review_relay", "answer", "other"] as const;
export const LOOP_KINDS = ["issue_to_pr", "ci_fix", "review_response", "test_fix", "lint_fix", "dependency_update"] as const;
export const PROPOSAL_KINDS = [
  "permissions", "hook", "skill", "rule", "agent", "command", "loop_prompt", "mcp_config", "claude_md",
] as const;
export const MEASUREMENTS = ["measured", "not_measured"] as const;

const Seconds = Type.Number({ minimum: 0 });
const Median = Type.Union([Seconds, Type.Null()]);

// measuredなら数値（件数0の中央値はnull）、not_measuredなら全項目null。
const measuredOrNot = (measured: Record<string, TSchema>) =>
  Type.Union([
    Type.Object({ measurement: Type.Literal("measured"), ...measured }, closed),
    Type.Object(
      {
        measurement: Type.Literal("not_measured"),
        ...Object.fromEntries(Object.keys(measured).map((k) => [k, Type.Null()])),
      },
      closed,
    ),
  ]);

const byKind = <K extends readonly string[]>(kinds: K, value: TSchema) =>
  Type.Object(Object.fromEntries(kinds.map((k) => [k, value])) as Record<K[number], TSchema>, closed);

const Intervention = measuredOrNot({ count: Count, wait_seconds_median: Median });
const Loop = measuredOrNot({ occurrences: Count, interventions: Count, duration_seconds_median: Median });

const mcpVariant = (callsMeasured: boolean, failuresMeasured: boolean) =>
  Type.Object(
    {
      server: Token(),
      configured: Type.Boolean(),
      measurement: Type.Literal(callsMeasured ? "measured" : "not_measured"),
      calls: callsMeasured ? Count : Type.Null(),
      failures_measurement: Type.Literal(failuresMeasured ? "measured" : "not_measured"),
      failures: failuresMeasured ? Count : Type.Null(),
    },
    closed,
  );

const McpServer = Type.Union([
  mcpVariant(true, true), mcpVariant(true, false), mcpVariant(false, true), mcpVariant(false, false),
]);
const ProposalCount = Type.Object({ shown: Count, applied_detected: Count }, closed);

export const AnalysisReportSchema = Type.Object(
  {
    agent: Agent,
    session_id: Token(),
    // 記録から取れなければ省略（session registrationのfirst_prompt_idと同じ意味）。
    first_prompt_id: Type.Optional(Token()),
    started_at: Instant,
    analyzer_version: SemVer,
    parser_version: SemVer,
    interventions: byKind(INTERVENTION_KINDS, Intervention),
    loops: byKind(LOOP_KINDS, Loop),
    mcp_servers: Type.Array(McpServer),
    proposals: byKind(PROPOSAL_KINDS, ProposalCount),
    records_skipped: Count,
  },
  { $id: schemaId("analysis-report"), ...closed },
);
export type AnalysisReport = Static<typeof AnalysisReportSchema>;
```

`byKind`の型が`Record<string, TSchema>`に広がり、`AnalysisReport`の型が粗くなる場合は、`byKind`を使わず`Type.Object({ approval: Intervention, ... })`と明示的に列挙して型を保つ（振る舞いは同じ）。

- [ ] **Step 4: GREENを確認してcommitする**

```bash
pnpm exec vitest run packages/semconv/test/analysis-report.test.ts
```

Expected: `13 passed`

```bash
git add -A && git commit -m "feat(semconv): add analysis report schema with fixed vocabularies" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 汎用ingest APIのIssueとイベント

**Files:** Create `packages/semconv/test/ingest-items.test.ts`, `packages/semconv/src/schemas/ingest-items.ts`; Modify `fixtures.ts`

各項目の根拠は次のとおり。
- Issue: `external_id`による冪等（ingest-api.md）。`project_key`は所属するProjectのkeyで必須とし、存在しないkeyの要素は拒否する（`external_id`の更新でkeyが変われば、発行済みidentifierを保ったままIssueをそのProjectへ移す）。`title`、`description`、`raw_status`、`assignee`、`priority`、`due_on`、`parent_external_id`、`is_blocked`は、providerが正本である属性（control-plane.md「Issueの由来と状態」）。`status_category`はcontrol-plane.mdの正規カテゴリ。`source_updated_at`は古い入力を捨てる規則（telemetry-store.md）。`identifier`はcontrol-plane.md「Issueの識別子」（無ければHarnessforceが発行するため任意）。`url`はExternalRefの`external_url`。
- Event: `event_id`による冪等（ingest-api.md）。`event_type`、`occurred_at`、`actor_type`、`actor_id`、対象entity、`payload`、`correlation_id`、`causation_id`は、telemetry-store.mdの`activity_events`の列と語彙。対象entityの種類はcontrol-plane.mdの`EntityLink`。`entity.id`は内部IDではなく送信元でのID（sender-side ID）で、解決はingest APIで届いたExternalRefの中だけで行う。

- [ ] **Step 1: fixtureとfailing testを書く**

`fixtures.ts`に追記する:

```ts
export const ingestIssue = {
  external_id: "sheet-row-42",
  project_key: "OPS",
  identifier: "OPS-7",
  title: "Rotate staging credentials",
  status_category: "started",
  raw_status: "Doing",
  is_blocked: false,
  due_on: "2026-10-01",
  source_updated_at: "2026-09-26T03:00:00Z",
};

export const ingestEvent = {
  event_id: "deploy-2026-09-26-001",
  event_type: "release.published",
  occurred_at: "2026-09-26T04:00:00Z",
  actor_type: "integration",
  actor_id: "deploy-bot",
  entity: { type: "artifact", id: "web@1.4.0" },
  payload: { environment: "production" },
};
```

`packages/semconv/test/ingest-items.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { IngestEventSchema, IngestIssueSchema } from "../src/schemas/ingest-items.js";
import { ingestEvent, ingestIssue } from "./support/fixtures.js";
import { compile } from "./support/validator.js";

const issue = compile(IngestIssueSchema);
const event = compile(IngestEventSchema);

describe("ingest issue", () => {
  it("accepts the example", () => expect(issue(ingestIssue)).toBe(true));
  it.each([
    ["unknown status_category", { status_category: "in_review" }],
    ["due_on as an instant", { due_on: "2026-10-01T00:00:00Z" }],
    ["offset-less source_updated_at", { source_updated_at: "2026-09-26T03:00:00" }],
    ["unknown field", { origin: "native" }],
  ])("rejects %s", (_, patch) => expect(issue({ ...ingestIssue, ...patch })).toBe(false));
  it("requires external_id", () => {
    const { external_id, ...rest } = ingestIssue;
    expect(issue(rest)).toBe(false);
  });
  it("requires project_key", () => {
    const { project_key, ...rest } = ingestIssue;
    expect(issue(rest)).toBe(false);
  });
});

describe("ingest event", () => {
  it("accepts the example", () => expect(event(ingestEvent)).toBe(true));
  it.each([
    ["unknown event_type", { event_type: "deploy.done" }],
    ["unknown actor_type", { actor_type: "bot" }],
    ["unknown entity type", { entity: { type: "ticket", id: "1" } }],
    ["offset-less occurred_at", { occurred_at: "2026-09-26T04:00:00" }],
  ])("rejects %s", (_, patch) => expect(event({ ...ingestEvent, ...patch })).toBe(false));
});
```

- [ ] **Step 2: REDを確認する**

```bash
pnpm exec vitest run packages/semconv/test/ingest-items.test.ts
```

Expected: FAIL

- [ ] **Step 3: 実装する**

`packages/semconv/src/schemas/ingest-items.ts`:

```ts
import { type Static, Type } from "@sinclair/typebox";
import { EXECUTION_ACTOR_TYPES } from "../attributes.js";
import { CalendarDate, closed, Instant, schemaId, Token } from "./common.js";

const literals = <T extends readonly string[]>(values: T) => Type.Union(values.map((v) => Type.Literal(v)));

export const STATUS_CATEGORIES = ["backlog", "unstarted", "started", "done", "canceled"] as const;
export const ACTIVITY_EVENT_TYPES = [
  "issue.created", "issue.status_changed", "issue.assigned", "issue.updated",
  "pull_request.opened", "pull_request.merged", "pull_request.closed", "review.submitted",
  "commit.pushed", "ci.completed", "release.published", "run.started", "run.completed",
  "plan.updated", "decision.recorded", "config.changed", "evaluation.recorded",
] as const;
export const ENTITY_TYPES = ["issue", "pull_request", "ci_run", "run", "trace", "artifact"] as const;

export const IngestIssueSchema = Type.Object(
  {
    external_id: Token(),
    // 存在しないkeyの要素は拒否する（Harnessforce側でのDB検証。schemaはToken形式だけを保証する）。
    project_key: Token(),
    identifier: Type.Optional(Token(64)),
    title: Type.String({ minLength: 1, maxLength: 1000 }),
    description: Type.Optional(Type.String({ maxLength: 100_000 })),
    status_category: literals(STATUS_CATEGORIES),
    raw_status: Type.Optional(Type.String({ maxLength: 200 })),
    is_blocked: Type.Optional(Type.Boolean()),
    assignee: Type.Optional(Token()),
    priority: Type.Optional(Type.String({ maxLength: 100 })),
    due_on: Type.Optional(CalendarDate),
    parent_external_id: Type.Optional(Token()),
    url: Type.Optional(Type.String({ format: "uri", maxLength: 2048 })),
    source_updated_at: Instant,
  },
  { $id: schemaId("ingest-issue"), ...closed },
);
export type IngestIssue = Static<typeof IngestIssueSchema>;

export const IngestEventSchema = Type.Object(
  {
    event_id: Token(),
    event_type: literals(ACTIVITY_EVENT_TYPES),
    occurred_at: Instant,
    actor_type: literals(EXECUTION_ACTOR_TYPES),
    actor_id: Type.Optional(Token()),
    // idは内部IDではなく送信元でのID（sender-side）。解決はingest APIで届いたExternalRefの中だけで行う。
    entity: Type.Object({ type: literals(ENTITY_TYPES), id: Token() }, closed),
    payload: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    correlation_id: Type.Optional(Token()),
    causation_id: Type.Optional(Token()),
  },
  { $id: schemaId("ingest-event"), ...closed },
);
export type IngestEvent = Static<typeof IngestEventSchema>;
```

`url`の`format: "uri"`がAjvのstrict modeで未登録のformatとして失敗する場合は、`test/support/validator.ts`に`ajv.addFormat("uri", fullFormats.uri)`を追加する。

- [ ] **Step 4: GREENを確認してcommitする**

```bash
pnpm exec vitest run packages/semconv/test/ingest-items.test.ts
```

Expected: `12 passed`

```bash
git add -A && git commit -m "feat(semconv): add generic ingest issue and event schemas" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 公開entryとJSONにしたschemaの検証、build

**Files:** Create `packages/semconv/src/index.ts`, `packages/semconv/test/index.test.ts`

- [ ] **Step 1: failing testを書く**

`packages/semconv/test/index.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as semconv from "../src/index.js";
import * as fx from "./support/fixtures.js";
import { compile } from "./support/validator.js";

const examples: Record<keyof typeof semconv.SCHEMAS, unknown> = {
  "session-registration": fx.sessionRegistration,
  "session-import": fx.sessionImport,
  "config-snapshot": fx.configSnapshot,
  "analysis-report": fx.analysisReport,
  "ingest-issue": fx.ingestIssue,
  "ingest-event": fx.ingestEvent,
};

describe("public entry", () => {
  it.each(Object.entries(semconv.SCHEMAS))("%s works as plain JSON Schema with a major-scoped $id", (name, schema) => {
    const json = JSON.parse(JSON.stringify(schema));
    expect(json.$id).toBe(`urn:harnessforce:semconv:${semconv.SEMCONV_MAJOR}:${name}`);
    expect(compile(json)(examples[name as keyof typeof examples])).toBe(true);
  });

  it("keeps SEMCONV_MAJOR in sync with the package major", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(Number(pkg.version.split(".")[0])).toBe(semconv.SEMCONV_MAJOR);
  });

  it("re-exports attributes", () => expect(semconv.ATTR.issueIdentifier).toBe("hf.issue.identifier"));
});
```

- [ ] **Step 2: REDを確認する**

```bash
pnpm exec vitest run packages/semconv/test/index.test.ts
```

Expected: FAIL

- [ ] **Step 3: 実装する**

`packages/semconv/src/index.ts`:

```ts
import { AnalysisReportSchema } from "./schemas/analysis-report.js";
import { ConfigSnapshotSchema } from "./schemas/config-snapshot.js";
import { IngestEventSchema, IngestIssueSchema } from "./schemas/ingest-items.js";
import { SessionImportSchema } from "./schemas/session-import.js";
import { SessionRegistrationSchema } from "./schemas/session-registration.js";

export * from "./attributes.js";
export * from "./schemas/analysis-report.js";
export { SEMCONV_MAJOR, schemaId } from "./schemas/common.js";
export * from "./schemas/config-snapshot.js";
export * from "./schemas/ingest-items.js";
export * from "./schemas/session-import.js";
export { REGISTRATION_SOURCES, type SessionRegistration, SessionRegistrationSchema } from "./schemas/session-registration.js";

// 利用側はこの一覧から、自分のvalidatorでschemaをcompileする。Workers上ではコード生成を伴わないvalidatorを選ぶ。
export const SCHEMAS = {
  "session-registration": SessionRegistrationSchema,
  "session-import": SessionImportSchema,
  "config-snapshot": ConfigSnapshotSchema,
  "analysis-report": AnalysisReportSchema,
  "ingest-issue": IngestIssueSchema,
  "ingest-event": IngestEventSchema,
} as const;
```

- [ ] **Step 4: GREEN、build、packの中身を確認する**（1つずつ実行する）

```bash
pnpm exec vitest run packages/semconv
pnpm --filter @harnessforce/semconv build
cd packages/semconv && pnpm pack && tar -tzf harnessforce-semconv-0.1.0.tgz | grep -E 'dist/index\.(js|d\.ts)$' && rm harnessforce-semconv-0.1.0.tgz; cd ../..
```

Expected: semconvの全testがpassする。`package/dist/index.js`と`package/dist/index.d.ts`が表示される。

- [ ] **Step 5: commitする**

```bash
git add -A && git commit -m "feat(semconv): expose public entry with schema registry" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: CLIの骨組み（`hf --version`）

**Files:** Create `packages/cli/package.json`, `packages/cli/tsconfig.build.json`, `packages/cli/src/main.ts`, `packages/cli/src/bin.ts`, `packages/cli/test/main.test.ts`

- [ ] **Step 1: packageの設定を置く**

`packages/cli/package.json`（`repository`と`publishConfig`はsemconvと同じ形にし、`directory`だけ`packages/cli`にする）:

```json
{
  "name": "@harnessforce/cli",
  "version": "0.1.0",
  "description": "Harnessforce command line (hf)",
  "license": "Apache-2.0",
  "type": "module",
  "bin": { "hf": "./dist/bin.js" },
  "files": ["dist"],
  "engines": { "node": ">=22.21.1" },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/lambda-script/harnessforce-agent.git",
    "directory": "packages/cli"
  },
  "publishConfig": { "access": "public", "provenance": true },
  "scripts": { "build": "tsc -p tsconfig.build.json" }
}
```

`packages/cli/tsconfig.build.json`は、semconvのものと同じ内容にする。

- [ ] **Step 2: failing testを書く**

`packages/cli/test/main.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { run } from "../src/main.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function capture(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = run(argv, { stdout: (s) => out.push(s), stderr: (s) => err.push(s) });
  return { code, out: out.join(""), err: err.join("") };
}

describe("hf", () => {
  it("prints the package version for --version", () =>
    expect(capture(["--version"])).toEqual({ code: 0, out: `${pkg.version}\n`, err: "" }));

  it("rejects anything else with usage on stderr", () => {
    const r = capture(["init"]);
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toContain("Usage: hf --version");
  });
});
```

- [ ] **Step 3: REDを確認する**

```bash
pnpm exec vitest run packages/cli/test/main.test.ts
```

Expected: FAIL

- [ ] **Step 4: 実装する**

`packages/cli/src/main.ts`:

```ts
import { createRequire } from "node:module";

type Io = { stdout: (text: string) => void; stderr: (text: string) => void };

// src（test）とdist（公開物）のどちらから読んでも、1つ上がpackage.jsonになる。
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

export function run(argv: readonly string[], io: Io): number {
  if (argv.length === 1 && argv[0] === "--version") {
    io.stdout(`${version}\n`);
    return 0;
  }
  io.stderr("Usage: hf --version\n");
  return 1;
}
```

`packages/cli/src/bin.ts`:

```ts
#!/usr/bin/env node
import { run } from "./main.js";

process.exitCode = run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
```

- [ ] **Step 5: GREENを確認し、buildした物を実行する**（1つずつ実行する）

```bash
pnpm exec vitest run packages/cli/test/main.test.ts
pnpm --filter @harnessforce/cli build
node packages/cli/dist/bin.js --version
```

Expected: `2 passed`、`0.1.0`

- [ ] **Step 6: commitする**

```bash
git add -A && git commit -m "feat(cli): add hf skeleton with --version" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Claude Code pluginとmarketplaceの骨組み

**Files:** Create `.claude-plugin/marketplace.json`, `plugins/harnessforce/.claude-plugin/plugin.json`, `plugins/harnessforce/hooks/hooks.json`, `tests/plugin.test.ts`

名前はonboarding.mdの`/plugin install harnessforce@harnessforce-agent`に合わせる。

- [ ] **Step 1: failing testを書く**

`tests/plugin.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));

describe("plugin skeleton", () => {
  const marketplace = read(".claude-plugin/marketplace.json");
  const plugin = read("plugins/harnessforce/.claude-plugin/plugin.json");

  it("matches the install command in onboarding (harnessforce@harnessforce-agent)", () => {
    expect(marketplace.name).toBe("harnessforce-agent");
    expect(marketplace.plugins).toEqual([expect.objectContaining({ name: "harnessforce", source: "./plugins/harnessforce" })]);
    expect(plugin.name).toBe("harnessforce");
  });

  it("points the marketplace source at an existing plugin directory", () =>
    expect(existsSync(new URL("../plugins/harnessforce/.claude-plugin/plugin.json", import.meta.url))).toBe(true));

  it("ships no hook behavior yet", () => expect(read("plugins/harnessforce/hooks/hooks.json")).toEqual({ hooks: {} }));

  it("declares the public license and repository", () => {
    expect(plugin.license).toBe("Apache-2.0");
    expect(plugin.repository).toBe("https://github.com/lambda-script/harnessforce-agent");
  });
});
```

- [ ] **Step 2: REDを確認する**

```bash
pnpm exec vitest run tests/plugin.test.ts
```

Expected: FAIL（ENOENT）

- [ ] **Step 3: ファイルを置く**

`.claude-plugin/marketplace.json`:

```json
{
  "name": "harnessforce-agent",
  "owner": { "name": "Lambda Script" },
  "plugins": [
    {
      "name": "harnessforce",
      "source": "./plugins/harnessforce",
      "description": "Send Claude Code sessions to Harnessforce and link them to your issues"
    }
  ]
}
```

`plugins/harnessforce/.claude-plugin/plugin.json`:

```json
{
  "name": "harnessforce",
  "version": "0.1.0",
  "description": "Harnessforce plugin for Claude Code",
  "author": { "name": "Lambda Script" },
  "homepage": "https://github.com/lambda-script/harnessforce-agent",
  "repository": "https://github.com/lambda-script/harnessforce-agent",
  "license": "Apache-2.0"
}
```

`plugins/harnessforce/hooks/hooks.json`:

```json
{ "hooks": {} }
```

- [ ] **Step 4: GREENを確認してcommitする**

```bash
pnpm exec vitest run tests/plugin.test.ts
```

Expected: `4 passed`

```bash
git add -A && git commit -m "feat(plugin): add harnessforce plugin and marketplace skeleton" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: npm scopeの一元化、release契約、changesets

**Files:** Create `scripts/set-npm-scope.mjs`, `tests/set-npm-scope.test.ts`, `tests/release-contract.test.ts`, `.changeset/config.json`

- [ ] **Step 1: failing testを書く**

`tests/set-npm-scope.test.ts`:

```ts
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyScope } from "../scripts/set-npm-scope.mjs";

describe("applyScope", () => {
  it("renames every package and internal dependency to config.npmScope", () => {
    const dir = mkdtempSync(join(tmpdir(), "scope-"));
    cpSync(new URL("../packages", import.meta.url), join(dir, "packages"), {
      recursive: true,
      filter: (p) => !p.includes("node_modules"),
    });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ config: { npmScope: "@acme-hf" } }));
    writeFileSync(join(dir, "README.md"), "npm i @harnessforce/cli\n");

    applyScope(dir);

    const name = (p: string) => JSON.parse(readFileSync(join(dir, "packages", p, "package.json"), "utf8")).name;
    expect([name("semconv"), name("cli")]).toEqual(["@acme-hf/semconv", "@acme-hf/cli"]);
    expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("npm i @acme-hf/cli\n");
  });
});
```

`tests/release-contract.test.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const scope = read("package.json").config.npmScope as string;
const packages = readdirSync(new URL("../packages", import.meta.url)).map((dir) => ({
  dir,
  pkg: read(`packages/${dir}/package.json`),
}));

describe("release contract", () => {
  it.each(packages)("$dir uses the single npm scope", ({ dir, pkg }) => expect(pkg.name).toBe(`${scope}/${dir}`));

  it.each(packages)("$dir declares repository with directory and public provenance", ({ dir, pkg }) => {
    expect(pkg.repository).toEqual({
      type: "git",
      url: "git+https://github.com/lambda-script/harnessforce-agent.git",
      directory: `packages/${dir}`,
    });
    expect(pkg.publishConfig).toEqual({ access: "public", provenance: true });
    expect(pkg.license).toBe("Apache-2.0");
    expect(pkg.files).toEqual(["dist"]);
  });
});
```

- [ ] **Step 2: REDを確認する**

```bash
pnpm exec vitest run tests/set-npm-scope.test.ts tests/release-contract.test.ts
```

Expected: `set-npm-scope`はmoduleが無いためFAIL。`release-contract`はTask 2とTask 10の設定によりすでにpassする。これは既存の設定を固定するtestである。

- [ ] **Step 3: 実装する**

`scripts/set-npm-scope.mjs`:

```js
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

/** root package.jsonのconfig.npmScopeを、各packageの名前、内部依存、READMEへ反映する。 */
export function applyScope(rootDir) {
  const nextScope = readJson(join(rootDir, "package.json")).config.npmScope;
  const dirs = readdirSync(join(rootDir, "packages"));
  const currentScope = readJson(join(rootDir, "packages", dirs[0], "package.json")).name.split("/")[0];
  if (currentScope === nextScope) return;

  const rename = (name) => (name.startsWith(`${currentScope}/`) ? `${nextScope}/${name.slice(currentScope.length + 1)}` : name);
  for (const dir of dirs) {
    const file = join(rootDir, "packages", dir, "package.json");
    const pkg = readJson(file);
    const next = { ...pkg, name: rename(pkg.name) };
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      if (pkg[field]) next[field] = Object.fromEntries(Object.entries(pkg[field]).map(([k, v]) => [rename(k), v]));
    }
    writeJson(file, next);
  }
  const readme = join(rootDir, "README.md");
  writeFileSync(readme, readFileSync(readme, "utf8").replaceAll(`${currentScope}/`, `${nextScope}/`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) applyScope(process.cwd());
```

`tsconfig.json`は`.mjs`をtypecheckしない。testからの型のない`.mjs`のimportが`tsc`で失敗する場合は、`scripts/set-npm-scope.d.mts`（`export function applyScope(rootDir: string): void;`）を追加する。

- [ ] **Step 4: changesetsを入れる**

```bash
pnpm add -Dw @changesets/cli@^2.31.1
```

`.changeset/config.json`:

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.1/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

初回の0.1.0はchangesetを置かない。`changeset publish`は、registryに無いversionをpublishするためである。

- [ ] **Step 5: GREENを確認してcommitする**

```bash
pnpm exec vitest run tests/set-npm-scope.test.ts tests/release-contract.test.ts
```

Expected: 全件 passed

```bash
git add -A && git commit -m "chore: centralize npm scope and pin the release contract" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: CI workflow

**Files:** Create `.github/workflows/ci.yml`

actionのSHAは、`lambda-script/shared-workflows`の`changesets-release.yml`で固定済みのものを使う。publishしない`ci.yml`はprovenanceの制約を受けないが、releaseと揃えてGitHub-hosted runnerを使う。

- [ ] **Step 1: workflowを書く**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@8e8c483db84b4bee98b60c0593521ed34d9990e8 # v6.0.1
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4
      - uses: actions/setup-node@395ad3262231945c25e8478fd5baf05154b1d79f # v6.1.0
        with:
          node-version-file: .node-version
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

pnpmのversionは、`pnpm/action-setup`がroot `package.json`の`packageManager`から読む。

- [ ] **Step 2: localで同じcheckを通す**（1回だけ実行する）

```bash
pnpm check
```

Expected: lintのerror 0、`tsc`の出力なし、vitestの全件pass、2 packageのbuild成功

- [ ] **Step 3: commitする**

```bash
git add -A && git commit -m "ci: add lint, typecheck, test and build workflow" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: release workflow（無効の状態で置く）、registryの確認、README

**Files:** Create `.github/workflows/release.yml`, `scripts/verify-published.mjs`, `tests/verify-published.test.ts`; Modify `tests/release-contract.test.ts`, `README.md`

- [ ] **Step 1: failing testを書く**

`tests/verify-published.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { verifyPublished } from "../scripts/verify-published.mjs";

describe("verifyPublished", () => {
  const published = [{ name: "@harnessforce/semconv", version: "0.1.0" }];

  it("passes when the registry serves every published version", async () =>
    await expect(verifyPublished(published, async () => "0.1.0")).resolves.toBeUndefined());

  it("fails when the registry lags behind main", async () =>
    await expect(verifyPublished(published, async () => "")).rejects.toThrow("@harnessforce/semconv@0.1.0"));
});
```

`tests/release-contract.test.ts`に追記する:

```ts
describe("release workflow", () => {
  const yml = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

  it("stays disabled until the repository variable enables it", () =>
    expect(yml).toContain("if: vars.NPM_PUBLISH_ENABLED == 'true'"));
  it("grants OIDC for provenance on a GitHub-hosted runner", () => {
    expect(yml).toContain("id-token: write");
    expect(yml).toMatch(/runs-on: ubuntu-/);
  });
  it("passes the npm credential by an explicit secret name", () => {
    expect(yml).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}");
    expect(yml).not.toContain("secrets: inherit");
  });
  it("verifies the registry after publishing", () => expect(yml).toContain("node scripts/verify-published.mjs"));
});
```

- [ ] **Step 2: REDを確認する**

```bash
pnpm exec vitest run tests/verify-published.test.ts tests/release-contract.test.ts
```

Expected: FAIL（moduleが無い、ENOENT）

- [ ] **Step 3: 実装する**

`scripts/verify-published.mjs`:

```js
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);

// registryへの反映は数秒遅れることがあるため、10秒間隔で6回まで再試行する。
export async function npmView(spec) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { stdout } = await run("npm", ["view", spec, "version"]).catch(() => ({ stdout: "" }));
    if (stdout.trim()) return stdout.trim();
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  return "";
}

/** mergeの成功をreleaseの成功とみなさず、registryにversionが載ったことまで確かめる。 */
export async function verifyPublished(published, view = npmView) {
  const missing = [];
  for (const { name, version } of published) {
    if ((await view(`${name}@${version}`)) !== version) missing.push(`${name}@${version}`);
  }
  if (missing.length > 0) throw new Error(`not on registry: ${missing.join(", ")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await verifyPublished(JSON.parse(process.env.PUBLISHED_PACKAGES ?? "[]"));
}
```

`.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  release:
    # npm scopeが作られるまで無効にしておく。有効にする手順はREADMEの「Releasing」を参照。
    if: vars.NPM_PUBLISH_ENABLED == 'true'
    # npm provenanceはGitHub-hosted runnerでしか生成できない。
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    permissions:
      contents: write
      pull-requests: write
      id-token: write
    steps:
      - uses: actions/checkout@8e8c483db84b4bee98b60c0593521ed34d9990e8 # v6.0.1
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4
      - uses: actions/setup-node@395ad3262231945c25e8478fd5baf05154b1d79f # v6.1.0
        with:
          node-version-file: .node-version
          cache: pnpm
          registry-url: https://registry.npmjs.org
      - run: pnpm install --frozen-lockfile
      - id: changesets
        uses: changesets/action@a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d # v1.9.0
        with:
          version: pnpm run version-packages
          publish: pnpm run release
          commit: "chore: version packages"
          title: "chore: version packages"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
          NPM_CONFIG_PROVENANCE: "true"
      - name: Verify registry versions
        if: steps.changesets.outputs.published == 'true'
        env:
          PUBLISHED_PACKAGES: ${{ steps.changesets.outputs.publishedPackages }}
        run: node scripts/verify-published.mjs
```

`README.md`に「Releasing」節を追記する（既存の本文は変えない）:

````markdown
## Releasing

Publishing to npmjs is disabled until the npm scope exists. To enable it:

1. Decide the scope. It lives only in `package.json` → `config.npmScope` (currently `@harnessforce`).
   To change it, edit that value, run `pnpm scope:apply`, and commit the result.
2. Create the npm organization for that scope on npmjs.com.
3. Create a granular access token with read/write on that scope (publish must bypass 2FA), then:
   `gh secret set NPM_TOKEN -R lambda-script/harnessforce-agent`
4. In repository Settings → Actions → General, allow GitHub Actions to create pull requests.
5. `gh variable set NPM_PUBLISH_ENABLED --body true -R lambda-script/harnessforce-agent`
6. Re-run the latest `Release` workflow on `main`. It publishes 0.1.0 with provenance and fails
   unless `npm view <scope>/semconv@0.1.0 version` and `npm view <scope>/cli@0.1.0 version` resolve.
7. Confirm the provenance badge on each package page on npmjs.com.

Later releases: add a changeset (`pnpm changeset`) in the Delivery PR. Merging to `main` opens the
"chore: version packages" PR, and merging that PR publishes the packages.
````

- [ ] **Step 4: GREENを確認してcommitする**

```bash
pnpm exec vitest run tests/verify-published.test.ts tests/release-contract.test.ts
```

Expected: 全件 passed

```bash
git add -A && git commit -m "ci: add provenance release workflow gated until the npm scope exists" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: 最終確認、planの削除、Delivery PR

- [ ] **Step 1: 全checkを通す**（1回だけ実行する）

```bash
pnpm check
```

Expected: 全green

- [ ] **Step 2: pluginを手で確認する**（Claude Codeが入った端末で、repositoryのrootから実行する）

```text
/plugin marketplace add ./
/plugin install harnessforce@harnessforce-agent
```

Expected: errorなくinstallされる。hookは空なのでsessionの振る舞いは変わらない。確認後に`/plugin uninstall harnessforce@harnessforce-agent`と`/plugin marketplace remove harnessforce-agent`で戻す。

- [ ] **Step 3: semantic reviewを行う**

`lambda-harness:pre-pr`を実行し、次をreviewする。
- `reviewing-spec-fidelity`: 各schemaの項目と語彙が、正本のsemantic-conventions.mdとimprovement-loop.mdに一致するか。
- `reviewing-infra`: workflow、release契約、exports、declarationの生成。
- `code-reviewing`: diff全体。

blockingな指摘を解消する。

- [ ] **Step 4: 完了したplanを削除してpushし、PRを作る**

```bash
git rm docs/plans/2026-09-26-semconv-foundation.md
git commit -m "docs: remove completed semconv foundation plan" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feature/semconv-foundation
gh pr create --base main --title "feat: add semconv v0 and plugin skeleton" --body "$(cat <<'EOF'
## Summary
- `@harnessforce/semconv` 0.1.0: hf.* attributes and JSON Schemas + TS types for session registration, session import, config snapshot, analysis report, ingest issue and ingest event
- `@harnessforce/cli` skeleton (`hf --version`)
- Claude Code plugin + marketplace skeleton (no hooks yet)
- CI (lint/typecheck/test/build) and a provenance release workflow gated by `vars.NPM_PUBLISH_ENABLED`

Spec: lambda-script/harnessforce spec/harnessforce-pivot, spec/improvement-loop (approved)

## Test plan
- [ ] `pnpm check` green in CI
- [ ] Release workflow is skipped while `NPM_PUBLISH_ENABLED` is unset
- [ ] `/plugin install harnessforce@harnessforce-agent` works from a local marketplace

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: CIがgreenであることを確認する**

```bash
gh pr checks --watch
```

CIとreviewがgreenになってからsquash mergeし、branchを削除する。
