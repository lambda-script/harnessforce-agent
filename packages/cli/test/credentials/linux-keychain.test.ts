import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeychainItem } from "../../src/credentials/keychain.js";
import {
	type CredentialStore,
	createLinuxKeychain,
} from "../../src/credentials/linux-keychain.js";

type FakeStoreOptions = {
	items?: Record<string, string>;
	// すべての操作を失敗させる（storeに届かない、上限時間を超えた）。
	broken?: boolean;
	// このaccountの操作だけを失敗させる。
	failOn?: string;
	// setを呼び出し側が解決するまで終わらせない。
	holdWrites?: boolean;
};

// 1つの保存先の代わり。操作とその上限時間を記録する。
function fakeStore(options: FakeStoreOptions = {}) {
	const items = new Map(Object.entries(options.items ?? {}));
	const calls: string[] = [];
	const timeouts: number[] = [];
	const held: (() => void)[] = [];
	const record = (call: string, account: string, timeoutMs: number) => {
		calls.push(`${call} ${account}`);
		timeouts.push(timeoutMs);
		if (options.broken || account === options.failOn)
			throw new Error("store failure");
	};
	const store: CredentialStore & {
		list(timeoutMs: number): Promise<readonly KeychainItem[]>;
	} = {
		get: async (account, timeoutMs) => {
			record("get", account, timeoutMs);
			return items.get(account);
		},
		set: async (account, secret, timeoutMs) => {
			record("set", account, timeoutMs);
			if (options.holdWrites)
				await new Promise<void>((resolve) => held.push(resolve));
			items.set(account, secret);
		},
		delete: async (account, timeoutMs) => {
			record("delete", account, timeoutMs);
			items.delete(account);
		},
		list: async (timeoutMs) => {
			record("list", "*", timeoutMs);
			return [...items].map(([account, secret]) => ({ account, secret }));
		},
	};
	return { store, items, calls, timeouts, held };
}

const HINT = "linux hint";

function linuxKeychain(kernel = fakeStore(), secretService = fakeStore()) {
	return {
		kernel,
		secretService,
		keychain: createLinuxKeychain({
			kernel: kernel.store,
			secretService: secretService.store,
			unavailableHint: HINT,
		}),
	};
}

const WS1 = {
	"ws1:ingest-key": "hf_ik_ws1_a",
	"ws1:api-token": "token-a",
	"ws1:ingest-origin": "https://ingest.example.test",
	"ws1:url-origin": "https://app.example.test",
};
const openOptions = { previousWorkspaceId: "ws1", onWaiting: () => {} };

afterEach(() => {
	vi.useRealTimers();
});

describe("Linux keychain", () => {
	it("names the Linux hint for both stores being unusable", () => {
		expect(linuxKeychain().keychain.unavailableHint).toBe(HINT);
	});

	describe("availability outside init", () => {
		it("is available when the kernel keyring reads the probe, without the Secret Service", async () => {
			const { keychain, secretService, kernel } = linuxKeychain();
			expect(await keychain.isAvailable()).toBe(true);
			expect(kernel.calls).toEqual(["get availability-probe"]);
			expect(secretService.calls).toEqual([]);
		});

		it("is available when only the Secret Service reads the probe", async () => {
			const { keychain, secretService } = linuxKeychain(
				fakeStore({ broken: true }),
			);
			expect(await keychain.isAvailable()).toBe(true);
			expect(secretService.calls).toEqual(["get availability-probe"]);
		});

		it("is unavailable when neither store reads the probe", async () => {
			const { keychain } = linuxKeychain(
				fakeStore({ broken: true }),
				fakeStore({ broken: true }),
			);
			expect(await keychain.isAvailable()).toBe(false);
		});
	});

	describe("reading a workspace", () => {
		it("reads every item from the kernel keyring when it holds the ingest key", async () => {
			const { keychain, secretService } = linuxKeychain(
				fakeStore({ items: WS1 }),
				fakeStore({ items: { ...WS1, "ws1:ingest-key": "hf_ik_ws1_old" } }),
			);
			expect(await keychain.get("ws1:ingest-key")).toBe("hf_ik_ws1_a");
			expect(await keychain.get("ws1:url-origin")).toBe(
				"https://app.example.test",
			);
			// ロックされたSecret Serviceの解錠の確認を待たない。
			expect(secretService.calls).toEqual([]);
		});

		it("reads the Secret Service, bounded by 60 seconds, when the kernel keyring lacks the ingest key", async () => {
			const { keychain, secretService } = linuxKeychain(
				fakeStore({ items: { "ws1:url-origin": "https://kernel.example" } }),
				fakeStore({ items: WS1 }),
			);
			expect(await keychain.get("ws1:url-origin")).toBe(
				"https://app.example.test",
			);
			expect(secretService.timeouts).toEqual([60_000]);
		});

		it("treats a failing Secret Service as holding nothing while the kernel keyring works", async () => {
			const { keychain } = linuxKeychain(
				fakeStore(),
				fakeStore({ broken: true }),
			);
			expect(await keychain.get("ws1:ingest-key")).toBeUndefined();
		});

		it("fails the read only when both stores fail", async () => {
			const { keychain } = linuxKeychain(
				fakeStore({ broken: true }),
				fakeStore({ broken: true }),
			);
			await expect(keychain.get("ws1:ingest-key")).rejects.toThrow();
		});

		it("writes a refreshed token back to the store it read from", async () => {
			const { keychain, kernel, secretService } = linuxKeychain(
				fakeStore({ items: WS1 }),
				fakeStore({ items: WS1 }),
			);
			await keychain.set("ws1:api-token", "token-b");
			expect(kernel.items.get("ws1:api-token")).toBe("token-b");
			expect(secretService.items.get("ws1:api-token")).toBe("token-a");
		});

		it("bounds each Secret Service operation by the given timeout", async () => {
			const { keychain, secretService } = linuxKeychain(
				fakeStore(),
				fakeStore({ items: WS1 }),
			);
			const limited = keychain.withTimeout(1_000);
			await limited.get("ws1:ingest-key");
			await limited.set("ws1:api-token", "token-b");
			expect(secretService.timeouts).toEqual([1_000, 1_000]);
		});
	});

	describe("choosing the store for init", () => {
		it("chooses the Secret Service when writing and deleting the probe succeeds", async () => {
			const { keychain, secretService } = linuxKeychain(
				fakeStore({ items: { "ws1:ingest-key": "hf_ik_ws1_kernel" } }),
				fakeStore({ items: { "ws2:ingest-key": "hf_ik_ws2_a" } }),
			);
			const store = await keychain.openForInit(openOptions);
			expect(store?.isKernelKeyring).toBe(false);
			expect(secretService.calls.slice(0, 2)).toEqual([
				"set availability-probe",
				"delete availability-probe",
			]);
			expect(secretService.timeouts.slice(0, 2)).toEqual([60_000, 60_000]);
			// 両方の保存先の項目を読む。kernelのkeyringからは前回のWorkspaceの項目だけ。
			expect(store?.items).toEqual([
				{ account: "ws2:ingest-key", secret: "hf_ik_ws2_a" },
				{ account: "ws1:ingest-key", secret: "hf_ik_ws1_kernel" },
			]);
		});

		it("chooses the kernel keyring when the Secret Service probe fails, reading only the previous workspace", async () => {
			const { keychain, kernel, secretService } = linuxKeychain(
				fakeStore({
					items: {
						"ws1:ingest-key": "hf_ik_ws1_a",
						"ws1:api-token": "token-a",
						"ws2:ingest-key": "hf_ik_ws2_a",
					},
				}),
				fakeStore({ failOn: "availability-probe", items: WS1 }),
			);
			const store = await keychain.openForInit(openOptions);
			expect(store?.isKernelKeyring).toBe(true);
			expect(store?.items).toEqual([
				{ account: "ws1:ingest-key", secret: "hf_ik_ws1_a" },
				{ account: "ws1:api-token", secret: "token-a" },
			]);
			expect(secretService.calls).toEqual(["set availability-probe"]);
			await store?.set("ws1:ingest-key", "hf_ik_ws1_new");
			expect(kernel.items.get("ws1:ingest-key")).toBe("hf_ik_ws1_new");
			// Secret Serviceは使えないため、そこにある項目は消さない。
			await store?.deleteElsewhere("ws1");
			expect(secretService.items.get("ws1:ingest-key")).toBe("hf_ik_ws1_a");
		});

		it("reads nothing from the kernel keyring without a previous workspace", async () => {
			const { keychain, kernel } = linuxKeychain(
				fakeStore(),
				fakeStore({ broken: true }),
			);
			const store = await keychain.openForInit({
				...openOptions,
				previousWorkspaceId: undefined,
			});
			expect(store?.items).toEqual([]);
			expect(kernel.calls.filter((call) => call.startsWith("get"))).toEqual([]);
		});

		it("deletes the workspace items from the kernel keyring after saving to the Secret Service", async () => {
			const { keychain, kernel } = linuxKeychain(
				fakeStore({ items: { ...WS1, "ws2:ingest-key": "hf_ik_ws2_a" } }),
			);
			const store = await keychain.openForInit(openOptions);
			await store?.deleteElsewhere("ws1");
			expect([...kernel.items.keys()]).toEqual(["ws2:ingest-key"]);
		});

		it("ignores a kernel keyring that cannot delete after saving to the Secret Service", async () => {
			const { keychain } = linuxKeychain(fakeStore({ broken: true }));
			const store = await keychain.openForInit(openOptions);
			await expect(store?.deleteElsewhere("ws1")).resolves.toBeUndefined();
		});

		it("is unavailable when neither store can be written", async () => {
			const { keychain } = linuxKeychain(
				fakeStore({ broken: true }),
				fakeStore({ broken: true }),
			);
			expect(await keychain.openForInit(openOptions)).toBeUndefined();
		});

		it.each([
			[
				"the Secret Service cannot list its items",
				fakeStore(),
				fakeStore({ failOn: "*" }),
			],
			[
				"the kernel keyring cannot read the previous workspace",
				fakeStore({ failOn: "ws1:api-token" }),
				fakeStore({ broken: true }),
			],
		])("fails when %s", async (_, kernel, secretService) => {
			const { keychain } = linuxKeychain(kernel, secretService);
			await expect(keychain.openForInit(openOptions)).rejects.toThrow();
		});

		it("announces the wait only when the probe takes more than 2 seconds", async () => {
			vi.useFakeTimers();
			const secretService = fakeStore({ holdWrites: true });
			const { keychain } = linuxKeychain(fakeStore(), secretService);
			const onWaiting = vi.fn();
			const opened = keychain.openForInit({ ...openOptions, onWaiting });
			await vi.advanceTimersByTimeAsync(1_999);
			expect(onWaiting).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1);
			expect(onWaiting).toHaveBeenCalledOnce();
			for (const release of secretService.held) release();
			expect((await opened)?.isKernelKeyring).toBe(false);
		});

		it("does not announce a probe that finishes within 2 seconds", async () => {
			vi.useFakeTimers();
			const { keychain } = linuxKeychain();
			const onWaiting = vi.fn();
			await keychain.openForInit({ ...openOptions, onWaiting });
			await vi.advanceTimersByTimeAsync(5_000);
			expect(onWaiting).not.toHaveBeenCalled();
		});
	});

	// correlation.md「CLI」の`harnessforce otel-headers`: kernelのkeyringは再起動で消えるため、
	// 解錠済みのSecret Serviceへ移す。keyを最後に書き、途中で止まってもkeyとoriginの組を欠けさせない。
	describe("moving the kernel keyring items to the Secret Service", () => {
		it("writes the origins, token and key in that order, verifies them and deletes the kernel items", async () => {
			const { keychain, kernel, secretService } = linuxKeychain(
				fakeStore({ items: WS1 }),
				fakeStore({ items: { "ws1:ingest-key": "hf_ik_ws1_stale" } }),
			);
			await keychain.migrateFromKernel?.("ws1");
			expect(secretService.calls).toEqual([
				"get availability-probe",
				"delete ws1:ingest-key",
				"delete ws1:api-token",
				"delete ws1:ingest-origin",
				"delete ws1:url-origin",
				"set ws1:ingest-origin",
				"set ws1:url-origin",
				"set ws1:api-token",
				"set ws1:ingest-key",
				"get ws1:ingest-origin",
				"get ws1:url-origin",
				"get ws1:api-token",
				"get ws1:ingest-key",
			]);
			expect(Object.fromEntries(secretService.items)).toEqual(WS1);
			// keyを先に消し、以後の読み出しがSecret Serviceの揃った組を選ぶようにする。
			expect(kernel.calls.filter((call) => call.startsWith("delete"))).toEqual([
				"delete ws1:ingest-key",
				"delete ws1:api-token",
				"delete ws1:url-origin",
				"delete ws1:ingest-origin",
			]);
			expect(kernel.items.size).toBe(0);
		});

		it("bounds the probe by 200 milliseconds and does not wait for an unlock prompt", async () => {
			const { keychain, kernel, secretService } = linuxKeychain(
				fakeStore({ items: WS1 }),
				fakeStore({ broken: true }),
			);
			await keychain.migrateFromKernel?.("ws1");
			expect(secretService.calls).toEqual(["get availability-probe"]);
			expect(secretService.timeouts[0]).toBe(200);
			expect(Object.fromEntries(kernel.items)).toEqual(WS1);
		});

		it("removes what it wrote and keeps the kernel items when a write fails", async () => {
			const { keychain, kernel, secretService } = linuxKeychain(
				fakeStore({ items: WS1 }),
				fakeStore({ failOn: "ws1:api-token" }),
			);
			await keychain.migrateFromKernel?.("ws1");
			expect(secretService.items.has("ws1:ingest-origin")).toBe(false);
			expect(secretService.items.has("ws1:url-origin")).toBe(false);
			expect(secretService.items.has("ws1:ingest-key")).toBe(false);
			expect(Object.fromEntries(kernel.items)).toEqual(WS1);
		});

		it("keeps the kernel items when the read-back differs", async () => {
			const secretService = fakeStore();
			const original = secretService.store.get;
			secretService.store.get = async (account, timeoutMs) =>
				account === "ws1:ingest-key"
					? "hf_ik_other"
					: original(account, timeoutMs);
			const { keychain, kernel } = linuxKeychain(
				fakeStore({ items: WS1 }),
				secretService,
			);
			await keychain.migrateFromKernel?.("ws1");
			expect(Object.fromEntries(kernel.items)).toEqual(WS1);
			expect(secretService.items.has("ws1:ingest-key")).toBe(false);
		});

		it("does nothing when the workspace key is in the Secret Service", async () => {
			const { keychain, kernel, secretService } = linuxKeychain(
				fakeStore(),
				fakeStore({ items: WS1 }),
			);
			await keychain.migrateFromKernel?.("ws1");
			expect(kernel.calls).toEqual(["get ws1:ingest-key"]);
			expect(secretService.calls).toEqual([]);
		});

		it("stops within 1 second as a whole", async () => {
			vi.useFakeTimers();
			const { keychain, kernel, secretService } = linuxKeychain(
				fakeStore({ items: WS1 }),
				fakeStore({ holdWrites: true }),
			);
			const moving = keychain.migrateFromKernel?.("ws1");
			await vi.advanceTimersByTimeAsync(1_000);
			await moving;
			for (const resolve of secretService.held) resolve();
			await vi.advanceTimersByTimeAsync(0);
			expect(Object.fromEntries(kernel.items)).toEqual(WS1);
			// 途中だった書き込みも片付けの対象にし、keyの無い項目だけが残りうる。
			expect(secretService.items.has("ws1:ingest-key")).toBe(false);
		});
	});
});
