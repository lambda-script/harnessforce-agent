import { Type } from "@sinclair/typebox";
import { INSTANT_PATTERN, TOKEN_PATTERN } from "../values.js";

// 互換性の単位はmajor（semantic-conventions.md「互換性」）。$idにはmajorだけを含める。
export const SEMCONV_MAJOR = 0;
export const schemaId = (name: string) =>
	`urn:harnessforce:semconv:${SEMCONV_MAJOR}:${name}`;

export const Instant = Type.String({
	format: "date-time",
	pattern: INSTANT_PATTERN,
});
export const CalendarDate = Type.String({
	format: "date",
	pattern: "^\\d{4}-\\d{2}-\\d{2}$",
});
export const Sha256Hex = Type.String({ pattern: "^[0-9a-f]{64}$" });
export const CommitSha = Type.String({
	pattern: "^(?:[0-9a-f]{40}|[0-9a-f]{64})$",
});
// <host>/<owner>/<name>（semantic-conventions.md「repositoryの正規化」）。owner/nameだけの2segmentは拒否する。
export const RepositorySlug = Type.String({
	pattern: "^[a-z0-9.-]+/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$",
});
export const SemVer = Type.String({
	pattern: "^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$",
});
// minLengthとmaxLengthは、JSON Schemaの定義どおりcode pointで数える。
export const Token = (maxLength = 256) =>
	Type.String({ minLength: 1, maxLength, pattern: TOKEN_PATTERN });
export const Count = Type.Integer({ minimum: 0 });
export const Agent = Type.Union([
	Type.Literal("claude_code"),
	Type.Literal("codex"),
]);
export const closed = { additionalProperties: false } as const;
