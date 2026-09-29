// privacy-and-retention.md「Redaction」のパターンの種類。並びは当てる順序である。
export const REDACTION_KINDS = [
	"private_key",
	"connection_string",
	"jwt",
	"api_key",
	"bearer_token",
	"email",
	"phone",
] as const;
export type RedactionKind = (typeof REDACTION_KINDS)[number];

export type RedactionRule = Readonly<{ kind: RedactionKind; pattern: RegExp }>;

const API_KEY_PATTERNS = [
	// Anthropic（sk-ant-）とOpenAI（sk-、sk-proj-）
	"sk-[A-Za-z0-9_-]{20,}",
	"AIza[0-9A-Za-z_-]{35}",
	"gh[pousr]_[A-Za-z0-9]{36,}",
	"github_pat_[A-Za-z0-9_]{22,}",
	"(?:AKIA|ASIA)[0-9A-Z]{16}",
	// HarnessforceのIngestKey（hf_ik_）と、ApiTokenのaccess token（hf_at_）とrefresh token（hf_rt_）
	"hf_(?:ik|at|rt)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[A-Za-z0-9_-]{43}",
];

/**
 * 正規表現の正本（privacy-and-retention.md「Redaction」）。上から順に当て、先に伏せた箇所を後の規則で
 * 二重に数えない。接続文字列はemailより先、API keyはBearerより先に当てる。
 * 電話番号は、UUIDと日付の区切りに一致しないよう、前後に`-`と英数字を許さない。
 * 可変長の先頭を持つ規則は、直前が同じ文字種でない位置からだけ始める。途中の位置から何度も走査し直すと、
 * 処理時間が長さの2乗になるためである。
 * patternはglobalであり、`lastIndex`を持つ。`replace`以外（`test`、`exec`）で使う場合は写しを作る。
 */
export const REDACTION_RULES: readonly RedactionRule[] = [
	{
		kind: "private_key",
		pattern:
			/-----BEGIN [A-Z ]*PRIVATE KEY-----(?:(?!-----BEGIN )[\s\S])*?-----END [A-Z ]*PRIVATE KEY-----/g,
	},
	{
		kind: "connection_string",
		pattern:
			/(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s/@]+@[^\s"'<>]+/gi,
	},
	{
		kind: "jwt",
		pattern:
			/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
	},
	{
		kind: "api_key",
		pattern: new RegExp(
			`(?<![A-Za-z0-9])(?:${API_KEY_PATTERNS.join("|")})`,
			"g",
		),
	},
	{ kind: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g },
	{
		kind: "email",
		pattern:
			/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
	},
	{
		kind: "phone",
		pattern:
			/(?<![\w+])\+[1-9]\d{7,14}(?!\d)|(?<![\w-])0\d{1,4}-\d{1,4}-\d{4}(?![\w-])/g,
	},
];

export type RedactedText = Readonly<{ text: string; count: number }>;

export type RedactOptions = Readonly<{
	/** 名前を表すfieldでは、数字を含む名前を電話番号と誤検知して識別子を書き換えないよう使う。 */
	skipPhone?: boolean;
}>;

/** 一致した箇所を`[REDACTED:<種類>]`に置き換える。countは置き換えた箇所の数。 */
export function redactText(
	text: string,
	options: RedactOptions = {},
): RedactedText {
	const rules = options.skipPhone
		? REDACTION_RULES.filter(({ kind }) => kind !== "phone")
		: REDACTION_RULES;
	return rules.reduce<RedactedText>(
		(current, { kind, pattern }) => {
			let replaced = 0;
			const next = current.text.replace(pattern, () => {
				replaced += 1;
				return `[REDACTED:${kind}]`;
			});
			return { text: next, count: current.count + replaced };
		},
		{ text, count: 0 },
	);
}
