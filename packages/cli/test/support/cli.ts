import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Keychain, KeychainItem } from "../../src/credentials/keychain.js";
import { startLoopback } from "../../src/init/loopback.js";
import { type CliDeps, run } from "../../src/main.js";
import { tempDir } from "../config/support.js";

type FakeKeychainOptions = {
	available?: boolean;
	items?: Record<string, string>;
	failRead?: boolean;
	failWrite?: boolean;
	// このaccountへの書き込みだけを失敗させる。
	failWriteOn?: string;
};

// 実際のkeychainの代わり。itemsは書き込みで更新される。
export function fakeKeychain(options: FakeKeychainOptions = {}) {
	const items = new Map(Object.entries(options.items ?? {}));
	// 書き込みの順序。deleteは"delete <account>"とする。
	const writes: string[] = [];
	const fail = (when: boolean | undefined) => {
		if (when) throw new Error("keychain failure");
	};
	const keychain: Keychain = {
		isAvailable: async () => options.available ?? true,
		get: async (account) => {
			fail(options.failRead);
			return items.get(account);
		},
		set: async (account, secret) => {
			fail(options.failWrite || account === options.failWriteOn);
			items.set(account, secret);
			writes.push(account);
		},
		delete: async (account) => {
			fail(options.failWrite);
			items.delete(account);
			writes.push(`delete ${account}`);
		},
		list: async (): Promise<KeychainItem[]> => {
			fail(options.failRead);
			return [...items].map(([account, secret]) => ({ account, secret }));
		},
	};
	return { keychain, items, writes };
}

// keychainに触れてはいけないtestで使う。
export const untouchableKeychain: Keychain = {
	isAvailable: async () => {
		throw new Error("keychain must not be used");
	},
	get: async () => {
		throw new Error("keychain must not be used");
	},
	set: async () => {
		throw new Error("keychain must not be used");
	},
	delete: async () => {
		throw new Error("keychain must not be used");
	},
	list: async () => {
		throw new Error("keychain must not be used");
	},
};

export async function runCli(argv: string[], deps: Partial<CliDeps> = {}) {
	const out: string[] = [];
	const err: string[] = [];
	const code = await run(argv, {
		env: {},
		keychain: untouchableKeychain,
		fetch: (url, init) => fetch(url, init),
		// 実際のブラウザは開かない。
		openBrowser: async () => false,
		startLoopback,
		homeDir: "/nonexistent/hf-home",
		managedDir: "/nonexistent/hf-managed",
		defaultUrl: "https://app.example.test",
		callbackTimeoutMs: 5000,
		restoredEnv: {},
		cwd: "/nonexistent/hf-cwd",
		git: async () => undefined,
		now: () => new Date(),
		platform: "linux",
		launch: async () => {
			throw new Error("the agent must not be launched");
		},
		importGit: async () => undefined,
		sleep: async () => {},
		...deps,
		stdout: (text) => out.push(text),
		stderr: (text) => err.push(text),
	});
	return { code, out: out.join(""), err: err.join("") };
}

// managed settingsのdirectory。managed-settings.jsonとmanaged-settings.d/のfileを書く。
export function managedDir(
	settings: Record<string, unknown> | null,
	dropIns: Record<string, string> = {},
): string {
	const dir = tempDir("hf-managed-");
	if (settings)
		writeFileSync(join(dir, "managed-settings.json"), JSON.stringify(settings));
	if (Object.keys(dropIns).length > 0) {
		mkdirSync(join(dir, "managed-settings.d"));
		for (const [name, content] of Object.entries(dropIns))
			writeFileSync(join(dir, "managed-settings.d", name), content);
	}
	return dir;
}
