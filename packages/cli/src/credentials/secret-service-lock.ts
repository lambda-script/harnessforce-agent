import { type DBusConnection, openBus } from "./dbus.js";
import { KEYCHAIN_SERVICE } from "./keychain.js";

const SECRETS = "org.freedesktop.secrets";
const SERVICE_PATH = "/org/freedesktop/secrets";
const DEFAULT_COLLECTION = "/org/freedesktop/secrets/aliases/default";
// KDEのSecret Serviceの提供者（KF6のksecretd、それより前のkwalletd）。
const KWALLET_PROCESS = /^(ksecretd|kwalletd\d*)$/;

export type SecretServiceOperation = "get" | "set" | "delete";

export type SecretServiceProvider = {
	isKWallet: boolean;
	// defaultのcollectionの名前（KWalletではwalletの名前）。
	walletLabel: string | undefined;
};

// Secret Serviceの項目を、解錠の確認を出さずに操作できるかを確かめる。
// @napi-rs/keyringは、ロックされた項目やcollectionに当たると必ず解錠の確認を求め、止める手段を持たないため、操作の前に確かめる。
export type SecretServiceLock = {
	needsUnlock(
		operation: SecretServiceOperation,
		account: string,
		timeoutMs: number,
	): Promise<boolean>;
	provider(timeoutMs: number): Promise<SecretServiceProvider>;
};

type Options = {
	// session busのaddress。
	address: string | undefined;
	uid: number;
	// processの名前（Linuxの/proc/<pid>/comm）。
	readComm: (pid: number) => Promise<string>;
};

// libdbusと同じく、DBUS_SESSION_BUS_ADDRESSが無ければ$XDG_RUNTIME_DIR/busを使う。
export function sessionBusAddress(
	env: Record<string, string | undefined>,
): string | undefined {
	if (env.DBUS_SESSION_BUS_ADDRESS) return env.DBUS_SESSION_BUS_ADDRESS;
	if (env.XDG_RUNTIME_DIR) return `unix:path=${env.XDG_RUNTIME_DIR}/bus`;
	return undefined;
}

const property = (bus: DBusConnection, name: string) =>
	bus
		.call({
			destination: SECRETS,
			path: DEFAULT_COLLECTION,
			interface: "org.freedesktop.DBus.Properties",
			member: "Get",
			signature: "ss",
			body: ["org.freedesktop.Secret.Collection", name],
		})
		.then(([variant]) => (variant as { value: unknown }).value);

export function createSecretServiceLock({
	address,
	uid,
	readComm,
}: Options): SecretServiceLock {
	const withBus = async <T>(
		timeoutMs: number,
		use: (bus: DBusConnection) => Promise<T>,
	): Promise<T> => {
		if (!address) throw new Error("no D-Bus session bus");
		const bus = await openBus(address, uid, timeoutMs);
		try {
			return await use(bus);
		} finally {
			bus.close();
		}
	};

	return {
		needsUnlock: (operation, account, timeoutMs) =>
			withBus(timeoutMs, async (bus) => {
				const [unlocked, locked] = (await bus.call({
					destination: SECRETS,
					path: SERVICE_PATH,
					interface: "org.freedesktop.Secret.Service",
					member: "SearchItems",
					signature: "a{ss}",
					body: [{ service: KEYCHAIN_SERVICE, username: account }],
				})) as [string[], string[]];
				// libraryは見つかったロックされた項目をすべて解錠してから操作する。
				if (locked.length > 0) return true;
				if (unlocked.length > 0 || operation !== "set") return false;
				// 項目が無ければdefaultのcollectionに作る。ロックされていれば解錠を、無ければ作る確認を求める。
				return property(bus, "Locked").then(
					(isLocked) => isLocked === true,
					() => true,
				);
			}),
		provider: (timeoutMs) =>
			withBus(timeoutMs, async (bus) => {
				const [pid] = (await bus.call({
					destination: "org.freedesktop.DBus",
					path: "/org/freedesktop/DBus",
					interface: "org.freedesktop.DBus",
					member: "GetConnectionUnixProcessID",
					signature: "s",
					body: [SECRETS],
				})) as [number];
				const comm = (await readComm(pid)).trim();
				const label = await property(bus, "Label").catch(() => undefined);
				return {
					isKWallet: KWALLET_PROCESS.test(comm),
					walletLabel: typeof label === "string" ? label : undefined,
				};
			}),
	};
}
