// correlation.md「CLI」の`harnessforce init`、control-plane.md「IngestKey と ApiToken」、telemetry-pipeline.mdが定める文言。
export const INIT_MESSAGES = {
	success:
		"Harnessforceに接続しました。Claude Codeを再起動すると設定が反映されます",
	invalidUrl: "接続先のURLが不正です",
	keychainUnavailable:
		"OSのキーチェーンを利用できないため、送信キーを保存できません",
	// Linuxで両方の保存先が使えなかったときだけ、keychainを使えない文言に続ける。
	linuxKeychainUnavailable:
		"Secret Service（GNOME KeyringまたはKWallet）とkernelのkeyringのどちらも使えません。コンテナやCIでは、Workspace用の送信キーをmanaged settingsで配るようOwnerかAdminに依頼してください",
	waitingForSecretService:
		"Secret Serviceの解錠の確認を待っています（最大60秒）",
	savedToKernelKeyring:
		"Secret Serviceを使えないため、送信キーをkernelのkeyringに保存しました。再起動するか、一定期間使わないと消えます。消えたら`harnessforce init`を再実行してください",
	tooManyKeys:
		"keychainにある送信キーが多すぎるため、`harnessforce init`を実行できません",
	tooManyCredentials:
		"keychainにある送信キーまたはログインの情報が多すぎるため、`harnessforce init`を実行できません",
	settingsUnreadable: "Claude Codeのuser settingsを読めません",
	network:
		"Harnessforceとの通信に失敗しました。もう一度`harnessforce init`を実行してください",
	listenFailed: "ログインの待ち受けを開始できませんでした",
	timeout:
		"ログインが時間内に完了しませんでした。もう一度`harnessforce init`を実行してください",
	accessDenied: "ログインが拒否されました",
	noWorkspace:
		"参加しているWorkspaceがありません。Workspaceを作成するか招待を受諾してから、もう一度`harnessforce init`を実行してください",
	loginFailed:
		"ログインに失敗しました。もう一度`harnessforce init`を実行してください",
	viewer:
		"閲覧のみのロールでは送信キーを発行できません。Workspaceの管理者に連絡してください",
	limitOwnerAdmin:
		"有効な送信キーの数が上限に達しました。送信キーの画面で使っていないキーを失効してください",
	limitMember:
		"送信キーの上限に達しています。Workspaceの管理者に連絡してください",
	gateUnavailable:
		"受信側へ反映できませんでした。変更はしていません。もう一度お試しください",
	ingestUnavailable:
		"この環境はテレメトリを受信しないため、送信キーを発行できません",
	saveFailed:
		"送信キーを保存できませんでした。もう一度`harnessforce init`を実行してください",
	codexSaveFailed:
		"Codexの設定を書き込めませんでした。もう一度`harnessforce init`を実行してください",
	contentEnabled:
		"入力した指示の本文を送る設定を有効にしました。パターンに一致した秘密値と個人情報を伏せ字にしますが、すべてを検出できるとは限りません。保存した本文は、Workspaceのメンバーの中ではあなただけが読め、本文データの保持期間（最大30日）が過ぎると削除されます",
	contentNotOptedIn:
		"このWorkspaceは本文データをopt-inしていないため、本文を送る設定は有効にしませんでした。Workspaceの設定のデータの保持でopt-inしてから、もう一度`harnessforce init --send-content`を実行してください",
} as const;

// 手順8: Codexの`config.toml`を書いた後の案内。trustは利用者の操作で、`harnessforce init`は代行できない。
export const codexNotes = (configPath: string) =>
	[
		`Codexの設定を書き込みました（${configPath}）。Codexを再起動すると反映されます`,
		"Codexのhookは、Codexの/hooksで内容をtrustするまで実行されません。/hooksでharnessforceのSessionStartのhookをtrustしてください",
		"HarnessforceのMCPを使う場合は、`codex mcp login harnessforce`でログインしてください",
	].join("\n");

export type InitMessage = keyof typeof INIT_MESSAGES;

// buildの既定以外の接続先へ向けたときに、利用者が気づくための1行。
export const nonDefaultConnectionMessage = (url: string) =>
	`接続先: ${url}（既定の本番ではありません）`;

// portを確保できなかったときの文言。既定の8080は一般的なHTTPのportで衝突しやすいため、
// 使えなかったportと`harnessforce init --port`の逃げ道を示す（correlation.md「CLI」）。
export const listenFailedMessage = (port: number) =>
	`${INIT_MESSAGES.listenFailed}。ポート ${port}を使っているプロセスを終えるか、\`harnessforce init --port\`で別のポートを指定してください`;

// keychainが使えるかを確かめて使えなかったときの文言。Linuxでは両方の保存先が使えない理由と逃げ道を続ける（correlation.md「実行環境」）。
export const keychainUnavailableMessage = (
	keychain: { unavailableHint?: string },
	message: string = INIT_MESSAGES.keychainUnavailable,
) =>
	keychain.unavailableHint
		? `${message}。${keychain.unavailableHint}`
		: message;
