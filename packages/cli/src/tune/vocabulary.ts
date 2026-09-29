// improvement-loop.md「送る値（固定語彙）」のカテゴリを判定する、公開の語彙リスト。
// analyzer_versionの一部であり、ここを変えたらanalyze.tsのANALYZER_VERSIONを上げる。
// 判定に使うpromptとcommandの本文は端末の外へ出ず、判定の結果の件数だけを送る。

// 内容を持たない続行の指示（`continue`）。NFKCで正規化し、小文字にして、末尾の句読点を除いた全体と比べる。
export const CONTINUE_PHRASES: ReadonlySet<string> = new Set([
	"continue",
	"go",
	"go ahead",
	"go on",
	"keep going",
	"proceed",
	"next",
	"yes",
	"y",
	"ok",
	"okay",
	"sure",
	"lgtm",
	"続けて",
	"続けてください",
	"続行",
	"続行して",
	"進めて",
	"進めてください",
	"お願いします",
	"はい",
	"うん",
	"いいよ",
	"どうぞ",
]);

// CIの失敗の内容を人が渡したprompt（`ci_relay`）。
export const CI_RELAY_PATTERNS: readonly RegExp[] = [
	/\bci\b[^\n]{0,40}\b(fail(ed|ing|ure|s)?|red|broken?|error)/i,
	/\b(fail(ed|ing|ure|s)?|broken)\b[^\n]{0,40}\bci\b/i,
	/github actions/i,
	/##\[error\]/,
	/process completed with exit code [1-9]/i,
	/\bchecks? (have |has )?failed\b/i,
	/CI[^\n]{0,20}(落ち|失敗|エラー|こけ|コケ|通らな)/,
	/(落ち|失敗)[^\n]{0,20}CI/,
];

// Pull Requestのreviewの指摘を人が渡したprompt（`review_relay`）。
export const REVIEW_RELAY_PATTERNS: readonly RegExp[] = [
	/\breview(er)?\b[^\n]{0,40}\b(comments?|feedback|suggest(s|ed|ion)?|asks?|requested)\b/i,
	/\brequested changes\b/i,
	/レビュー[^\n]{0,20}(指摘|コメント|フィードバック)/,
	/(指摘|コメント)[^\n]{0,20}レビュー/,
];

// ループの一巡を判定するcommand（Bash toolの`command`）。
export const COMMANDS = {
	test: /\b(vitest|jest|pytest|mocha|rspec|phpunit)\b|\b(go|cargo|bun|deno) test\b|\bplaywright test\b|\b(npm|pnpm|yarn)\b[^|;&\n]*\btest\b/,
	lint: /\b(eslint|biome|tsc|ruff|mypy|golangci-lint|clippy|stylelint)\b|\bprettier\b[^|;&\n]*--check\b|\b(npm|pnpm|yarn)\b[^|;&\n]*\b(lint|typecheck|check-types|type-check)\b/,
	ciCheck: /\bgh (run (view|watch|list)|pr checks)\b/,
	reviewFetch:
		/\bgh pr view\b[^|;&\n]*--comments\b|\bgh api\b[^|;&\n]*\/(comments|reviews)\b/,
	issueFetch: /\bgh issue view\b/,
	prCreate: /\bgh pr create\b/,
	push: /\bgit push\b/,
	dependencyUpdate:
		/\b(npm|pnpm|yarn|bun) (up|update|upgrade)\b|\b(npm|pnpm|yarn|bun) (add|install|i) [^|;&\n]*@(latest|next|\^?\d)|\bncu\b|\bcargo update\b|\bgo get -u\b|\bpip install (-U|--upgrade)\b|\b(bundle|poetry) update\b/,
} as const;

// CIの確認の出力のうち、失敗を示すもの。
export const CI_FAILURE_OUTPUT = /\b(fail(ed|ing|ure|s)?|error)\b/i;

// 修正とみなすtool。
export const EDIT_TOOLS: ReadonlySet<string> = new Set([
	"Edit",
	"MultiEdit",
	"Write",
	"NotebookEdit",
]);

// Issueを取得するMCPのtool（Harnessforceの`get_issue`など）。
export const ISSUE_TOOL = /^mcp__.+__get_issue$/;
