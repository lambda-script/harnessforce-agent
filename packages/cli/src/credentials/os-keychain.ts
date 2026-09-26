import { KEYCHAIN_SERVICE, type Keychain } from "./keychain.js";

type KeyringEntry = {
	getPassword(): string | null;
	setPassword(password: string): void;
	deleteCredential(): boolean;
};

// @napi-rs/keyringのうち使う部分。testではfakeを渡し、実際のkeychainに触れない。
export type KeyringModule = {
	Entry: new (
		service: string,
		account: string,
		options?: { linux?: { store?: "secret-service" | "keyutils" } },
	) => KeyringEntry;
	findCredentials(service: string): { account: string; password: string }[];
};

const SUPPORTED_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set([
	"darwin",
	"linux",
	"win32",
]);
// 既定のLinuxはSecret Serviceが無いとkernelのkeyring（再起動で消える）へ黙って切り替わるため、Secret Serviceに固定する。
// 固定すると、Secret Serviceが無い端末ではEntryの作成が例外になる。
const ENTRY_OPTIONS = { linux: { store: "secret-service" } } as const;
// 存在しない項目を読んで、storeに届くかだけを確かめる。
const PROBE_ACCOUNT = "availability-probe";

type Options = {
	platform: NodeJS.Platform;
	load: () => Promise<KeyringModule>;
};

export function createOsKeychain({ platform, load }: Options): Keychain {
	let loaded: Promise<KeyringModule> | undefined;
	const keyring = () => {
		loaded ??= load();
		return loaded;
	};
	const entry = async (account: string) =>
		new (await keyring()).Entry(KEYCHAIN_SERVICE, account, ENTRY_OPTIONS);

	return {
		async isAvailable() {
			if (!SUPPORTED_PLATFORMS.has(platform)) return false;
			try {
				(await entry(PROBE_ACCOUNT)).getPassword();
				return true;
			} catch {
				return false;
			}
		},
		async get(account) {
			return (await entry(account)).getPassword() ?? undefined;
		},
		async set(account, secret) {
			(await entry(account)).setPassword(secret);
		},
		async delete(account) {
			(await entry(account)).deleteCredential();
		},
		async list() {
			return (await keyring())
				.findCredentials(KEYCHAIN_SERVICE)
				.map(({ account, password }) => ({ account, secret: password }));
		},
	};
}
