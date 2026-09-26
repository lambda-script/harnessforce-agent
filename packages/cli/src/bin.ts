#!/usr/bin/env node
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { createOsKeychain } from "./credentials/os-keychain.js";
import { openBrowser } from "./init/browser.js";
import { startLoopback } from "./init/loopback.js";
import { run } from "./main.js";

// buildが書く既定の接続先（scripts/build-config.mjs）。distのbin.jsと同じdirectoryにある。
const { url: defaultUrl } = createRequire(import.meta.url)(
	"./build-config.json",
) as { url: string };
// correlation.md「CLI」: 待ち受けを始めてから5分以内にcallbackが来なければ終える。
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

process.exitCode = await run(process.argv.slice(2), {
	env: process.env,
	keychain: createOsKeychain({
		platform: process.platform,
		// native moduleは使う時だけ読み込み、読めない端末ではkeychainが使えないものとして扱う。
		load: () => import("@napi-rs/keyring"),
	}),
	stdout: (text) => process.stdout.write(text),
	stderr: (text) => process.stderr.write(text),
	fetch: (url, init) => fetch(url, init),
	openBrowser: (url) => openBrowser(url, process.platform),
	startLoopback,
	homeDir: homedir(),
	defaultUrl,
	callbackTimeoutMs: CALLBACK_TIMEOUT_MS,
});
