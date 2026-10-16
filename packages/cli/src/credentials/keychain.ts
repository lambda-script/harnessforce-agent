// CLIの資格情報の保存先（correlation.md「実行環境」）。macOS Keychain、Windows Credential Manager、
// LinuxではSecret Serviceとkernelのkeyringだけを使い、平文で保存しない。
export type KeychainItem = { account: string; secret: string };

export type Keychain = {
	// 読み書きの前に確かめる。falseならkeyを発行も読み出しもしない。
	isAvailable(): Promise<boolean>;
	// isAvailableがfalseのときに、keychainを使えない文言へ続ける案内。
	unavailableHint?: string;
	get(account: string): Promise<string | undefined>;
	set(account: string, secret: string): Promise<void>;
	// 項目が無くても成功とする。
	delete(account: string): Promise<void>;
	// kernelのkeyringにあるWorkspaceの項目を、解錠済みのSecret Serviceへ移す（Linuxだけ）。失敗しても例外を投げない。
	migrateFromKernel?(workspaceId: string): Promise<void>;
	// 各操作の上限時間をmsにしたkeychain。超えた操作は失敗する。
	withTimeout(ms: number): Keychain;
	// `harnessforce init`の手順1。保存先を選び、既存の項目を読む。使えなければundefined、読めなければ例外。
	openForInit(options: InitOpenOptions): Promise<InitKeychain | undefined>;
};

export type InitOpenOptions = {
	// user settingsの`HARNESSFORCE_WORKSPACE_ID`。列挙できない保存先からは、このWorkspaceの項目だけを読む。
	previousWorkspaceId: string | undefined;
	// 保存先を確かめる操作が解錠の確認を待っているとき。
	onWaiting: () => void;
};

export type InitKeychain = {
	// 保存先がkernelのkeyring（再起動で消える）のときtrue。
	isKernelKeyring: boolean;
	items: readonly KeychainItem[];
	set(account: string, secret: string): Promise<void>;
	delete(account: string): Promise<void>;
	// 手順5: もう一方の保存先が使えれば、そこにある同じWorkspaceの項目を削除する。
	deleteElsewhere(workspaceId: string): Promise<void>;
};

// 保存先が1つのOS（macOSとWindows）のinit。
export async function openSingleStore(store: {
	isAvailable(): Promise<boolean>;
	list(): Promise<readonly KeychainItem[]>;
	set(account: string, secret: string): Promise<void>;
	delete(account: string): Promise<void>;
}): Promise<InitKeychain | undefined> {
	if (!(await store.isAvailable())) return undefined;
	return {
		isKernelKeyring: false,
		items: await store.list(),
		set: (account, secret) => store.set(account, secret),
		delete: (account) => store.delete(account),
		deleteElsewhere: async () => {},
	};
}

// correlation.md「CLI」の手順5。
export const KEYCHAIN_SERVICE = "harnessforce";
const INGEST_KEY_SUFFIX = ":ingest-key";
const API_TOKEN_SUFFIX = ":api-token";

export const ingestKeyAccount = (workspaceId: string) =>
	`${workspaceId}${INGEST_KEY_SUFFIX}`;
export const apiTokenAccount = (workspaceId: string) =>
	`${workspaceId}${API_TOKEN_SUFFIX}`;
// harnessforce initが保存したingestの送信先のorigin。利用者用のkeyはこのoriginへだけ出す。
export const ingestOriginAccount = (workspaceId: string) =>
	`${workspaceId}:ingest-origin`;
// harnessforce initが使った接続先のorigin。ApiTokenはRead APIのbase URLがこのoriginの場合だけ送る。
export const urlOriginAccount = (workspaceId: string) =>
	`${workspaceId}:url-origin`;
// 手順5で保存するWorkspaceの4つの項目。
export const workspaceAccounts = (workspaceId: string) => [
	ingestKeyAccount(workspaceId),
	apiTokenAccount(workspaceId),
	ingestOriginAccount(workspaceId),
	urlOriginAccount(workspaceId),
];
export const isIngestKeyAccount = (account: string) =>
	account.endsWith(INGEST_KEY_SUFFIX);
// `<workspace_id>:api-token`のWorkspaceのid。ApiTokenの項目でなければundefined。
export const apiTokenWorkspaceId = (account: string) =>
	account.endsWith(API_TOKEN_SUFFIX)
		? account.slice(0, -API_TOKEN_SUFFIX.length)
		: undefined;
