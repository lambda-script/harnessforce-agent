// correlation.md「CLI」の`hf init`、control-plane.md「IngestKey と ApiToken」、telemetry-pipeline.mdが定める文言。
export const INIT_MESSAGES = {
	success:
		"Harnessforceに接続しました。Claude Codeを再起動すると設定が反映されます",
	invalidUrl: "接続先のURLが不正です",
	keychainUnavailable:
		"OSのキーチェーンを利用できないため、送信キーを保存できません",
	tooManyKeys:
		"keychainにある送信キーが多すぎるため、`hf init`を実行できません",
	tooManyCredentials:
		"keychainにある送信キーまたはログインの情報が多すぎるため、`hf init`を実行できません",
	settingsUnreadable: "Claude Codeのuser settingsを読めません",
	network:
		"Harnessforceとの通信に失敗しました。もう一度`hf init`を実行してください",
	listenFailed: "ログインの待ち受けを開始できませんでした",
	timeout:
		"ログインが時間内に完了しませんでした。もう一度`hf init`を実行してください",
	accessDenied: "ログインが拒否されました",
	noWorkspace:
		"参加しているWorkspaceがありません。Workspaceを作成するか招待を受諾してから、もう一度`hf init`を実行してください",
	loginFailed: "ログインに失敗しました。もう一度`hf init`を実行してください",
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
		"送信キーを保存できませんでした。もう一度`hf init`を実行してください",
	contentNotOptedIn:
		"このWorkspaceは本文データをopt-inしていないため、本文を送る設定は有効にしませんでした。Workspaceの設定のデータの保持でopt-inしてから、もう一度`hf init --send-content`を実行してください",
} as const;

export type InitMessage = keyof typeof INIT_MESSAGES;

// portを確保できなかったときの文言。既定の8080は一般的なHTTPのportで衝突しやすいため、
// 使えなかったportと`hf init --port`の逃げ道を示す（correlation.md「CLI」）。
export const listenFailedMessage = (port: number) =>
	`${INIT_MESSAGES.listenFailed}。port ${port}を使っているprocessを終えるか、\`hf init --port\`で別のportを指定してください`;
