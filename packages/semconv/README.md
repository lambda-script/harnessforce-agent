# @harnessforce/semconv

The semantic conventions of [Harnessforce](https://github.com/lambda-script/harnessforce-agent): the
`hf.*` OpenTelemetry resource attribute names and the JSON Schemas of the items sent to the
Harnessforce ingest API. The `hf` CLI and the Claude Code plugin hook build what they send from this
package, and the Harnessforce service validates what it receives against the same schemas.

## Install

```sh
npm install @harnessforce/semconv
```

It is an ES module with no side effects and one runtime dependency,
[`@sinclair/typebox`](https://github.com/sinclairzx81/typebox). Node.js 18 or later.

## Usage

### Attributes

```ts
import { ATTR, EXECUTION_MODES } from "@harnessforce/semconv";

const attributes = {
  [ATTR.issueIdentifier]: "ENG-42", // "hf.issue.identifier"
  [ATTR.vcsRepository]: "github.com/acme/web", // "hf.vcs.repository"
  [ATTR.executionMode]: EXECUTION_MODES[1], // "ai"
};
```

`ATTR` maps each attribute to its name (`hf.workspace.id`, `hf.issue.identifier`,
`hf.agent.config_version`, `hf.vcs.branch`, ...). `EXECUTION_MODES` and `EXECUTION_ACTOR_TYPES` list
the allowed values of `hf.execution.mode` and `hf.execution.actor_type`.

### Schemas

Each schema is a plain JSON Schema object (built with TypeBox) with a static TypeScript type:

| Key in `SCHEMAS` | Schema | Type |
| --- | --- | --- |
| `session-registration` | `SessionRegistrationSchema` | `SessionRegistration` |
| `session-import` | `SessionImportSchema` | `SessionImport` |
| `config-snapshot` | `ConfigSnapshotSchema` | `ConfigSnapshot` |
| `analysis-report` | `AnalysisReportSchema` | `AnalysisReport` |
| `ingest-issue` | `IngestIssueSchema` | `IngestIssue` |
| `ingest-event` | `IngestEventSchema` | `IngestEvent` |

Compile them with the JSON Schema validator of your choice. The schemas use the `date-time`, `date`
and `uri` formats, so enable format validation. On runtimes that forbid code generation, such as
Cloudflare Workers, pick a validator that does not generate code.

```ts
import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import { SCHEMAS, type SessionRegistration } from "@harnessforce/semconv";

const ajv = new Ajv({ strict: true });
addFormats(ajv);
const validate = ajv.compile<SessionRegistration>(SCHEMAS["session-registration"]);
```

Every schema's `$id` is `urn:harnessforce:semconv:<major>:<name>` (`schemaId(name)`, with
`SEMCONV_MAJOR`), so a consumer can tell which major a schema belongs to.

### Repository names

`normalizeRepository(remoteUrl)` turns a git remote URL (HTTPS, SSH or scp-like) into the
lowercase `<host>/<owner>/<name>` form used by `hf.vcs.repository` (for example
`git@github.com:Acme/Web.git` becomes `github.com/acme/web`), and returns `undefined` for remotes that do
not have that shape, such as local paths, `file://` URLs and GitLab subgroups.

### Secret patterns

```ts
import { REDACTION_RULES, redactText } from "@harnessforce/semconv";

redactText("DATABASE_URL=postgres://app:pa55word@db.internal/main");
// { text: "DATABASE_URL=[REDACTED:connection_string]", count: 1 }
```

`REDACTION_RULES` lists, in the order they are applied, the regular expressions that the Harnessforce
service uses to redact telemetry: `private_key`, `connection_string`, `jwt`, `api_key` (Anthropic,
OpenAI and Google API keys, GitHub tokens, AWS access key IDs, and Harnessforce ingest keys, access
tokens and refresh tokens), `bearer_token`, `email` and `phone` (E.164 and Japanese domestic numbers).
`redactText` replaces each match with `[REDACTED:<kind>]` and counts the replacements. Pass
`{ skipPhone: true }` for names, where digits are not phone numbers. The patterns are global
regular expressions; copy one before calling `test` or `exec` on it.

## Versioning

This package follows semantic versioning from 0.1.0: adding attributes or vocabulary is a minor
release, and changing their meaning or removing them is a major release.

## License

[Apache-2.0](https://github.com/lambda-script/harnessforce-agent/blob/main/LICENSE)
