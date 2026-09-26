// CLIの資格情報の保存先（correlation.md「実行環境」）。macOS Keychain、Secret Service、Credential Managerだけを使い、平文で保存しない。
export type KeychainItem = { account: string; secret: string };

export type Keychain = {
	// 読み書きの前に確かめる。falseならkeyを発行も読み出しもしない。
	isAvailable(): Promise<boolean>;
	get(account: string): Promise<string | undefined>;
	set(account: string, secret: string): Promise<void>;
	list(): Promise<readonly KeychainItem[]>;
};

// correlation.md「CLI」の手順5。
export const KEYCHAIN_SERVICE = "harnessforce";
const INGEST_KEY_SUFFIX = ":ingest-key";

export const ingestKeyAccount = (workspaceId: string) =>
	`${workspaceId}${INGEST_KEY_SUFFIX}`;
export const apiTokenAccount = (workspaceId: string) =>
	`${workspaceId}:api-token`;
export const isIngestKeyAccount = (account: string) =>
	account.endsWith(INGEST_KEY_SUFFIX);
