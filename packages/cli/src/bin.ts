#!/usr/bin/env node
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { createOsKeychain } from "./credentials/os-keychain.js";
import { createImportGit } from "./import/repository.js";
import { openBrowser } from "./init/browser.js";
import { startLoopback } from "./init/loopback.js";
import { run } from "./main.js";
import { managedDirFor } from "./managed.js";
import { createGitRunner } from "./process/git.js";
import { spawnSelf, takeStashedRuntimeEnv } from "./process/runtime-env.js";
import { relaunchHf } from "./relaunch.js";
import { launchAgent } from "./run/process.js";

// buildが書く既定の接続先（scripts/build-config.mjs）。distのbin.jsと同じdirectoryにある。
const { url: defaultUrl } = createRequire(import.meta.url)(
	"./build-config.json",
) as { url: string };
// correlation.md「CLI」: 待ち受けを始めてから5分以内にcallbackが来なければ終える。
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

const argv = process.argv.slice(2);
// 起動し直す前のprocessが取り除いた実行時の変数。agentとブラウザを開くcommandの環境へだけ戻す。
const restoredEnv = takeStashedRuntimeEnv(process.env, process.platform);
const relaunched = await relaunchHf(argv, {
	platform: process.platform,
	env: process.env,
	spawnSelf,
	stderr: (text) => process.stderr.write(text),
});

process.exitCode =
	relaunched ??
	(await run(argv, {
		env: process.env,
		keychain: createOsKeychain({
			platform: process.platform,
			// native moduleは使う時だけ読み込み、読めない端末ではkeychainが使えないものとして扱う。
			load: () => import("@napi-rs/keyring"),
		}),
		stdout: (text) => process.stdout.write(text),
		stderr: (text) => process.stderr.write(text),
		fetch: (url, init) => fetch(url, init),
		openBrowser: (url) =>
			openBrowser(url, {
				platform: process.platform,
				env: process.env,
				cwd: process.cwd(),
				restoredEnv,
			}),
		startLoopback,
		homeDir: homedir(),
		managedDir: managedDirFor(process.platform),
		defaultUrl,
		callbackTimeoutMs: CALLBACK_TIMEOUT_MS,
		cwd: process.cwd(),
		git: createGitRunner({
			platform: process.platform,
			env: process.env,
			processCwd: process.cwd(),
			excludeTarget: false,
		}),
		now: () => new Date(),
		platform: process.platform,
		restoredEnv,
		launch: (launch) =>
			launchAgent(launch, {
				platform: process.platform,
				env: process.env,
				cwd: process.cwd(),
				tmpDir: tmpdir(),
			}),
		importGit: createImportGit(process.env, process.cwd()),
		sleep: (ms) => delay(ms),
	}));
