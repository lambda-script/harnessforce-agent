import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { afterEach, describe, expect, it } from "vitest";
import type { SecretServiceLock } from "../../src/credentials/secret-service-lock.js";
import { createSecretServiceProcess } from "../../src/credentials/secret-service-process.js";

// @napi-rs/keyringの代わり。項目はfileに置き、子processの間で共有する。
// accountが"hang"の操作は終わらない（ロックされたSecret Serviceの解錠の確認を待つ状態）。
const FAKE_KEYRING = `
const { readFileSync, writeFileSync } = require("node:fs");
const file = process.env.HF_FAKE_KEYRING_FILE;
const load = () => JSON.parse(readFileSync(file, "utf8"));
const save = (items) => writeFileSync(file, JSON.stringify(items));
const SECRET_SERVICE = JSON.stringify({ linux: { store: "secret-service" } });
exports.AsyncEntry = class {
	constructor(service, account, options) {
		if (JSON.stringify(options) !== SECRET_SERVICE) throw new Error("not pinned");
		if (load().broken) throw new Error("The name is not activatable");
		this.key = service + "/" + account;
		this.hangs = account === "hang";
	}
	async getPassword() {
		if (this.hangs) {
			writeFileSync(file + ".pid", String(process.pid));
			return new Promise(() => setInterval(() => {}, 1000));
		}
		return load().items[this.key];
	}
	async setPassword(password) {
		const state = load();
		state.items[this.key] = password;
		save(state);
	}
	async deleteCredential() {
		const state = load();
		const existed = this.key in state.items;
		delete state.items[this.key];
		save(state);
		return existed;
	}
};
exports.findCredentialsAsync = async (service) =>
	Object.entries(load().items)
		.filter(([key]) => key.startsWith(service + "/"))
		.map(([key, password]) => ({ account: key.slice(service.length + 1), password }));
`;

const previousFile = process.env.HF_FAKE_KEYRING_FILE;
const hfFile = () => process.env.HF_FAKE_KEYRING_FILE ?? "";
afterEach(() => {
	if (previousFile === undefined) delete process.env.HF_FAKE_KEYRING_FILE;
	else process.env.HF_FAKE_KEYRING_FILE = previousFile;
});

// 解錠の状態の代わり。needsUnlockの結果を返し、呼ばれたoperationを記録する。
function fakeLock(needsUnlock: boolean | Error = false) {
	const checked: string[] = [];
	const lock: SecretServiceLock = {
		async needsUnlock(operation, account) {
			checked.push(`${operation} ${account}`);
			if (needsUnlock instanceof Error) throw needsUnlock;
			return needsUnlock;
		},
		provider: async () => ({ isKWallet: true, walletLabel: "kdewallet" }),
	};
	return { lock, checked };
}

function secretService(
	state: { items?: Record<string, string>; broken?: boolean } = {},
	lock: SecretServiceLock = fakeLock().lock,
) {
	const dir = tempDir("hf-secret-service-");
	const modulePath = join(dir, "fake-keyring.cjs");
	const file = join(dir, "items.json");
	writeFileSync(modulePath, FAKE_KEYRING);
	writeFileSync(file, JSON.stringify({ items: {}, ...state }));
	process.env.HF_FAKE_KEYRING_FILE = file;
	return {
		store: createSecretServiceProcess({
			execPath: process.execPath,
			resolveKeyring: () => modulePath,
			lock,
		}),
		items: () =>
			(JSON.parse(readFileSync(file, "utf8")) as { items: object }).items,
	};
}

describe("Secret Service in a child process", () => {
	it("reads, writes, lists and deletes items under the harnessforce service", async () => {
		const { store, items } = secretService();
		await store.set("ws1:ingest-key", "hf_ik_ws1_secret\nwith newline", 10_000);
		expect(items()).toEqual({
			"harnessforce/ws1:ingest-key": "hf_ik_ws1_secret\nwith newline",
		});
		expect(await store.get("ws1:ingest-key", 10_000)).toBe(
			"hf_ik_ws1_secret\nwith newline",
		);
		expect(await store.get("ws2:ingest-key", 10_000)).toBeUndefined();
		expect(await store.list(10_000)).toEqual([
			{ account: "ws1:ingest-key", secret: "hf_ik_ws1_secret\nwith newline" },
		]);
		await store.delete("ws1:ingest-key", 10_000);
		await store.delete("ws1:ingest-key", 10_000);
		expect(items()).toEqual({});
	});

	it("fails when the Secret Service cannot be reached", async () => {
		const { store } = secretService({ broken: true });
		await expect(store.get("ws1:ingest-key", 10_000)).rejects.toThrow();
	});

	it("fails when the module cannot be resolved", async () => {
		const store = createSecretServiceProcess({
			execPath: process.execPath,
			resolveKeyring: () => {
				throw new Error("cannot find module");
			},
			lock: fakeLock().lock,
		});
		await expect(store.get("ws1:ingest-key", 10_000)).rejects.toThrow();
	});

	it("gives up an operation that exceeds the timeout", async () => {
		const { store } = secretService();
		const started = Date.now();
		await expect(store.get("hang", 500)).rejects.toThrow();
		expect(Date.now() - started).toBeLessThan(5_000);
		// 解錠の確認を待つ子processを残さない。
		const pid = Number(readFileSync(`${hfFile()}.pid`, "utf8"));
		expect(() => process.kill(pid, 0)).toThrow(/ESRCH/);
	});

	it("does not consult the lock state when unlock prompts are allowed", async () => {
		const { lock, checked } = fakeLock(true);
		const { store } = secretService({ items: { "harnessforce/a": "x" } }, lock);
		expect(await store.get("a", 10_000)).toBe("x");
		expect(checked).toEqual([]);
	});
});

describe("Secret Service without unlock prompts", () => {
	it("fails an operation that needs an unlock prompt without starting it", async () => {
		const { lock, checked } = fakeLock(true);
		const { store } = secretService({}, lock);
		const started = Date.now();
		await expect(
			store.withoutUnlockPrompt().get("hang", 10_000),
		).rejects.toThrow(/locked/);
		expect(Date.now() - started).toBeLessThan(2_000);
		expect(existsSync(`${hfFile()}.pid`)).toBe(false);
		expect(checked).toEqual(["get hang"]);
	});

	it("runs an operation that needs no unlock prompt", async () => {
		const { lock, checked } = fakeLock(false);
		const { store, items } = secretService({}, lock);
		const quiet = store.withoutUnlockPrompt();
		await quiet.set("ws1:ingest-key", "hf_ik", 10_000);
		expect(await quiet.get("ws1:ingest-key", 10_000)).toBe("hf_ik");
		await quiet.delete("ws1:ingest-key", 10_000);
		expect(items()).toEqual({});
		expect(checked).toEqual([
			"set ws1:ingest-key",
			"get ws1:ingest-key",
			"delete ws1:ingest-key",
		]);
	});

	it("fails without starting the operation when the lock state cannot be read", async () => {
		const { lock } = fakeLock(new Error("no D-Bus session bus"));
		const { store } = secretService({}, lock);
		await expect(
			store.withoutUnlockPrompt().get("hang", 10_000),
		).rejects.toThrow();
		expect(existsSync(`${hfFile()}.pid`)).toBe(false);
	});

	it("reports the Secret Service provider", async () => {
		const { store } = secretService();
		await expect(store.provider(1_000)).resolves.toEqual({
			isKWallet: true,
			walletLabel: "kdewallet",
		});
	});
});
