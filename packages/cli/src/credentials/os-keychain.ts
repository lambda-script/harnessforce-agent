import { INIT_MESSAGES } from "../shared/messages.js";
import {
	KEYCHAIN_SERVICE,
	type Keychain,
	openSingleStore,
} from "./keychain.js";
import {
	type CredentialStore,
	createLinuxKeychain,
	type SecretServiceStore,
} from "./linux-keychain.js";

type KeyringEntry = {
	getPassword(): string | null;
	setPassword(password: string): void;
	deleteCredential(): boolean;
};

type AsyncKeyringEntry = {
	getPassword(): Promise<string | null | undefined>;
	setPassword(password: string): Promise<void>;
	deleteCredential(): Promise<boolean>;
};

// @napi-rs/keyringのうち使う部分。testではfakeを渡し、実際のkeychainに触れない。
export type KeyringModule = {
	AsyncEntry: new (service: string, account: string) => AsyncKeyringEntry;
	Entry: new (
		service: string,
		account: string,
		options?: { linux?: { store?: "secret-service" | "keyutils" } },
	) => KeyringEntry;
	findCredentials(service: string): { account: string; password: string }[];
};

type Options = {
	platform: NodeJS.Platform;
	load: () => Promise<KeyringModule>;
	// LinuxのSecret Service。解錠の確認を待つ操作を打ち切れる手段で行う。
	secretService: SecretServiceStore;
};

// 存在しない項目を読んで、storeに届くかだけを確かめる。
const PROBE_ACCOUNT = "availability-probe";

export function createOsKeychain({
	platform,
	load,
	secretService,
}: Options): Keychain {
	let loaded: Promise<KeyringModule> | undefined;
	const keyring = () => {
		loaded ??= load();
		return loaded;
	};
	if (platform === "linux")
		return createLinuxKeychain({
			kernel: kernelKeyring(keyring),
			secretService,
			unavailableHint: INIT_MESSAGES.linuxKeychainUnavailable,
		});
	if (platform === "darwin" || platform === "win32")
		return singleStore(keyring);
	return unsupported;
}

// kernelのpersistent keyring。無指定のEntryはSecret Serviceが無いと保存先を黙って切り替えるため、明示する。
function kernelKeyring(keyring: () => Promise<KeyringModule>): CredentialStore {
	const entry = async (account: string) =>
		new (await keyring()).Entry(KEYCHAIN_SERVICE, account, {
			linux: { store: "keyutils" },
		});
	return {
		get: async (account) => (await entry(account)).getPassword() ?? undefined,
		set: async (account, secret) => (await entry(account)).setPassword(secret),
		delete: async (account) => {
			(await entry(account)).deleteCredential();
		},
	};
}

// macOS KeychainとWindows Credential Manager。
function singleStore(keyring: () => Promise<KeyringModule>): Keychain {
	const entry = async (account: string) =>
		new (await keyring()).Entry(KEYCHAIN_SERVICE, account);
	const keychain: Keychain = {
		async isAvailable() {
			try {
				(await entry(PROBE_ACCOUNT)).getPassword();
				return true;
			} catch {
				return false;
			}
		},
		get: async (account) => (await entry(account)).getPassword() ?? undefined,
		set: async (account, secret) => (await entry(account)).setPassword(secret),
		delete: async (account) => {
			(await entry(account)).deleteCredential();
		},
		withTimeout: (ms) => limitedSingleStore(keychain, keyring, ms),
		openForInit: () =>
			openSingleStore({
				...keychain,
				list: async () =>
					(await keyring())
						.findCredentials(KEYCHAIN_SERVICE)
						.map(({ account, password }) => ({ account, secret: password })),
			}),
	};
	return keychain;
}

// 同期の呼び出しはevent loopを止めて打ち切れないため、上限を持つ操作はthread poolで行い、上限時間で待つのをやめる。
// 許可の確認を待つ呼び出しそのものは残るが、呼び出し側は失敗として先へ進める。
function limitedSingleStore(
	base: Keychain,
	keyring: () => Promise<KeyringModule>,
	ms: number,
): Keychain {
	const within =
		<T>(operation: (entry: AsyncKeyringEntry) => Promise<T>) =>
		async (account: string): Promise<T> => {
			const entry = new (await keyring()).AsyncEntry(KEYCHAIN_SERVICE, account);
			let timer: NodeJS.Timeout | undefined;
			const timeout = new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error("keychain timed out")), ms);
			});
			return Promise.race([operation(entry), timeout]).finally(() =>
				clearTimeout(timer),
			);
		};
	return {
		...base,
		get: async (account) =>
			(await within((entry) => entry.getPassword())(account)) ?? undefined,
		set: (account, secret) =>
			within((entry) => entry.setPassword(secret))(account),
		delete: async (account) => {
			await within((entry) => entry.deleteCredential())(account);
		},
	};
}

const unsupportedError = async (): Promise<never> => {
	throw new Error("no keychain on this platform");
};

const unsupported: Keychain = {
	isAvailable: async () => false,
	get: unsupportedError,
	set: unsupportedError,
	delete: unsupportedError,
	withTimeout: () => unsupported,
	openForInit: async () => undefined,
};
