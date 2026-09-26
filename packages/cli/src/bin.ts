#!/usr/bin/env node
import { createOsKeychain } from "./credentials/os-keychain.js";
import { run } from "./main.js";

process.exitCode = await run(process.argv.slice(2), {
	env: process.env,
	keychain: createOsKeychain({
		platform: process.platform,
		// native moduleは使う時だけ読み込み、読めない端末ではkeychainが使えないものとして扱う。
		load: () => import("@napi-rs/keyring"),
	}),
	stdout: (text) => process.stdout.write(text),
	stderr: (text) => process.stderr.write(text),
});
