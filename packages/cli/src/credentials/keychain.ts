// CLIの資格情報の保存先（correlation.md「実行環境」）。macOS Keychain、Secret Service、Credential Managerだけを使い、平文で保存しない。
export type KeychainItem = { account: string; secret: string };

export type Keychain = {
	// 読み書きの前に確かめる。falseならkeyを発行も読み出しもしない。
	isAvailable(): Promise<boolean>;
	get(account: string): Promise<string | undefined>;
	set(account: string, secret: string): Promise<void>;
	// 項目が無くても成功とする。
	delete(account: string): Promise<void>;
	list(): Promise<readonly KeychainItem[]>;
};

// correlation.md「CLI」の手順5。
export const KEYCHAIN_SERVICE = "harnessforce";
const INGEST_KEY_SUFFIX = ":ingest-key";

export const ingestKeyAccount = (workspaceId: string) =>
	`${workspaceId}${INGEST_KEY_SUFFIX}`;
export const apiTokenAccount = (workspaceId: string) =>
	`${workspaceId}:api-token`;
// hf initが保存したingestの送信先のorigin。利用者用のkeyはこのoriginへだけ出す。
export const ingestOriginAccount = (workspaceId: string) =>
	`${workspaceId}:ingest-origin`;
// hf initが使った接続先のorigin。ApiTokenはRead APIのbase URLがこのoriginの場合だけ送る。
export const urlOriginAccount = (workspaceId: string) =>
	`${workspaceId}:url-origin`;
export const isIngestKeyAccount = (account: string) =>
	account.endsWith(INGEST_KEY_SUFFIX);
