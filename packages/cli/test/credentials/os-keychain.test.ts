import { describe, expect, it } from "vitest";
import {
	apiTokenAccount,
	ingestKeyAccount,
	KEYCHAIN_SERVICE,
} from "../../src/credentials/keychain.js";
import {
	createOsKeychain,
	type KeyringModule,
} from "../../src/credentials/os-keychain.js";

type Created = { service: string; account: string; options: unknown };

// @napi-rs/keyringの代わり。実際のkeychainには触れない。
function fakeKeyring(
	options: { failConstruct?: boolean; failRead?: boolean } = {},
) {
	const store = new Map<string, string>();
	const created: Created[] = [];
	const module: KeyringModule = {
		Entry: class {
			readonly #key: string;
			constructor(service: string, account: string, entryOptions?: unknown) {
				if (options.failConstruct) throw new Error("no secret service");
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

const keychainOn = (platform: NodeJS.Platform, keyring = fakeKeyring()) => ({
	keyring,
	keychain: createOsKeychain({
		platform,
		load: async () => keyring.module,
	}),
});

describe("OS keychain", () => {
	it("names accounts per workspace under the harnessforce service", () => {
		expect(KEYCHAIN_SERVICE).toBe("harnessforce");
		expect(ingestKeyAccount("ws1")).toBe("ws1:ingest-key");
		expect(apiTokenAccount("ws1")).toBe("ws1:api-token");
	});

	it("stores and reads secrets and pins Linux to the Secret Service", async () => {
		const { keychain, keyring } = keychainOn("linux");
		await keychain.set("ws1:ingest-key", "hf_ik_ws1_secret");
		expect(await keychain.get("ws1:ingest-key")).toBe("hf_ik_ws1_secret");
		expect(await keychain.get("ws2:ingest-key")).toBeUndefined();
		expect(await keychain.list()).toEqual([
			{ account: "ws1:ingest-key", secret: "hf_ik_ws1_secret" },
		]);
		for (const entry of keyring.created) {
			expect(entry.service).toBe("harnessforce");
			// 無指定ではSecret Serviceが無いとkernelのkeyring（再起動で消える）へ黙って切り替わるため固定する。
			expect(entry.options).toEqual({ linux: { store: "secret-service" } });
		}
	});

	it.each([
		"darwin",
		"linux",
		"win32",
	] as const)("is available on %s when the store can be read", async (platform) =>
		expect(await keychainOn(platform).keychain.isAvailable()).toBe(true));

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
		});
		expect(await keychain.isAvailable()).toBe(false);
		expect(loaded).toBe(false);
	});

	it.each([
		["the native module cannot be loaded", undefined],
		["the Secret Service is missing", { failConstruct: true }],
		["the store cannot be read", { failRead: true }],
	])("is unavailable when %s", async (_, failure) => {
		const keychain = createOsKeychain({
			platform: "linux",
			load: async () => {
				if (!failure) throw new Error("cannot find module");
				return fakeKeyring(failure).module;
			},
		});
		expect(await keychain.isAvailable()).toBe(false);
	});
});
