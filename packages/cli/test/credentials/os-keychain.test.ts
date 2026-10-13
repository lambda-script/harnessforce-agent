import { describe, expect, it } from "vitest";
import {
	apiTokenAccount,
	ingestKeyAccount,
	KEYCHAIN_SERVICE,
} from "../../src/credentials/keychain.js";
import type { SecretServiceStore } from "../../src/credentials/linux-keychain.js";
import {
	createOsKeychain,
	type KeyringModule,
} from "../../src/credentials/os-keychain.js";

type Created = { service: string; account: string; options: unknown };

// @napi-rs/keyringの代わり。実際のkeychainには触れない。
function fakeKeyring(
	options: {
		failConstruct?: boolean;
		failRead?: boolean;
		// AsyncEntryの操作を終わらせない（許可の確認に答えない状態）。
		hangAsync?: boolean;
	} = {},
) {
	const store = new Map<string, string>();
	const created: Created[] = [];
	const module: KeyringModule = {
		AsyncEntry: class {
			readonly #key: string;
			constructor(service: string, account: string, entryOptions?: unknown) {
				if (options.failConstruct) throw new Error("no store");
				created.push({ service, account, options: entryOptions });
				this.#key = `${service}/${account}`;
			}
			async getPassword() {
				if (options.hangAsync) return new Promise<never>(() => {});
				if (options.failRead) throw new Error("locked");
				return store.get(this.#key);
			}
			async setPassword(password: string) {
				store.set(this.#key, password);
			}
			async deleteCredential() {
				return store.delete(this.#key);
			}
		},
		Entry: class {
			readonly #key: string;
			constructor(service: string, account: string, entryOptions?: unknown) {
				if (options.failConstruct) throw new Error("no store");
				created.push({ service, account, options: entryOptions });
				this.#key = `${service}/${account}`;
			}
			getPassword() {
				if (options.failRead) throw new Error("locked");
				return store.get(this.#key) ?? null;
			}
			setPassword(password: string) {
				store.set(this.#key, password);
			}
			deleteCredential() {
				return store.delete(this.#key);
			}
		},
		findCredentials: (service) =>
			[...store.entries()]
				.filter(([key]) => key.startsWith(`${service}/`))
				.map(([key, password]) => ({
					account: key.slice(service.length + 1),
					password,
				})),
	};
	return { module, created, store };
}

// Secret Serviceが使えない端末（SSHだけで入る端末など）。
const missingSecretService: SecretServiceStore = {
	get: async () => {
		throw new Error("The name is not activatable");
	},
	set: async () => {
		throw new Error("The name is not activatable");
	},
	delete: async () => {
		throw new Error("The name is not activatable");
	},
	list: async () => {
		throw new Error("The name is not activatable");
	},
};

const keychainOn = (platform: NodeJS.Platform, keyring = fakeKeyring()) => ({
	keyring,
	keychain: createOsKeychain({
		platform,
		load: async () => keyring.module,
		secretService: missingSecretService,
	}),
});

describe("OS keychain", () => {
	it("names accounts per workspace under the harnessforce service", () => {
		expect(KEYCHAIN_SERVICE).toBe("harnessforce");
		expect(ingestKeyAccount("ws1")).toBe("ws1:ingest-key");
		expect(apiTokenAccount("ws1")).toBe("ws1:api-token");
	});

	it.each([
		"darwin",
		"win32",
	] as const)("stores, reads and lists secrets on %s", async (platform) => {
		const { keychain, keyring } = keychainOn(platform);
		const store = await keychain.openForInit({
			previousWorkspaceId: undefined,
			onWaiting: () => {},
		});
		expect(store?.isKernelKeyring).toBe(false);
		await store?.set("ws1:ingest-key", "hf_ik_ws1_secret");
		expect(await keychain.get("ws1:ingest-key")).toBe("hf_ik_ws1_secret");
		expect(await keychain.withTimeout(1_000).get("ws2:ingest-key")).toBe(
			undefined,
		);
		expect(
			(
				await keychain.openForInit({
					previousWorkspaceId: undefined,
					onWaiting: () => {},
				})
			)?.items,
		).toEqual([{ account: "ws1:ingest-key", secret: "hf_ik_ws1_secret" }]);
		await keychain.delete("ws1:ingest-key");
		await keychain.delete("ws1:ingest-key");
		expect(await keychain.get("ws1:ingest-key")).toBeUndefined();
		for (const entry of keyring.created) {
			expect(entry.service).toBe("harnessforce");
			expect(entry.options).toBeUndefined();
		}
		expect(keychain.unavailableHint).toBeUndefined();
	});

	it("stores to the kernel keyring on Linux without the Secret Service", async () => {
		const { keychain, keyring } = keychainOn("linux");
		const store = await keychain.openForInit({
			previousWorkspaceId: undefined,
			onWaiting: () => {},
		});
		expect(store?.isKernelKeyring).toBe(true);
		await store?.set("ws1:ingest-key", "hf_ik_ws1_secret");
		expect(await keychain.isAvailable()).toBe(true);
		expect(await keychain.get("ws1:ingest-key")).toBe("hf_ik_ws1_secret");
		for (const entry of keyring.created) {
			expect(entry.service).toBe("harnessforce");
			// 無指定では保存先を黙って切り替えるため、kernelのkeyringを明示する。
			expect(entry.options).toEqual({ linux: { store: "keyutils" } });
		}
	});

	it.each([
		["the native module cannot be loaded", undefined],
		["the kernel keyring is forbidden", { failConstruct: true }],
	])("is unavailable on Linux without the Secret Service when %s", async (_, failure) => {
		const keychain = createOsKeychain({
			platform: "linux",
			load: async () => {
				if (!failure) throw new Error("cannot find module");
				return fakeKeyring(failure).module;
			},
			secretService: missingSecretService,
		});
		expect(await keychain.isAvailable()).toBe(false);
		expect(
			await keychain.openForInit({
				previousWorkspaceId: undefined,
				onWaiting: () => {},
			}),
		).toBeUndefined();
		expect(keychain.unavailableHint).toBe(
			"Secret Service（GNOME KeyringまたはKWallet）とkernelのkeyringのどちらも使えません。コンテナやCIでは、Workspace用の送信キーをmanaged settingsで配るようOwnerかAdminに依頼してください",
		);
	});

	it.each([
		"darwin",
		"win32",
	] as const)("gives up an operation on %s that exceeds the timeout", async (platform) => {
		const keyring = fakeKeyring({ hangAsync: true });
		const keychain = createOsKeychain({
			platform,
			load: async () => keyring.module,
			secretService: missingSecretService,
		});
		await expect(
			keychain.withTimeout(50).get("ws1:api-token"),
		).rejects.toThrow();
	});

	it.each([
		"darwin",
		"win32",
	] as const)("is unavailable on %s when the store cannot be read", async (platform) => {
		const { keychain } = keychainOn(platform, fakeKeyring({ failRead: true }));
		expect(await keychain.isAvailable()).toBe(false);
	});

	it.each([
		"freebsd",
		"openbsd",
		"aix",
		"sunos",
	] as const)("is unavailable on %s without loading the native module", async (platform) => {
		let loaded = false;
		const keychain = createOsKeychain({
			platform,
			load: async () => {
				loaded = true;
				return fakeKeyring().module;
			},
			secretService: missingSecretService,
		});
		expect(await keychain.isAvailable()).toBe(false);
		expect(
			await keychain.openForInit({
				previousWorkspaceId: undefined,
				onWaiting: () => {},
			}),
		).toBeUndefined();
		expect(loaded).toBe(false);
	});
});
