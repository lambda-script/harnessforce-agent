#!/usr/bin/env node
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { createInterface } from "node:readline/promises";
import { setTimeout as delay } from "node:timers/promises";
import { managedDirFor } from "@harnessforce/agent-core/managed";
import { createGitRunner } from "@harnessforce/agent-core/process/git";
import {
	spawnSelf,
	takeStashedRuntimeEnv,
} from "@harnessforce/agent-core/process/runtime-env";
import { createOsKeychain } from "./credentials/os-keychain.js";
import { createImportGit } from "./import/repository.js";
import { openBrowser } from "./init/browser.js";
import { startLoopback } from "./init/loopback.js";
import { run } from "./main.js";
import { relaunchHf } from "./relaunch.js";
import { launchAgent } from "./run/process.js";
import { createProcessIo } from "./top/process-io.js";
import { runOriginalCommand } from "./usage-limits/original.js";
import { spawnUsageSender } from "./usage-limits/spawn-sender.js";

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
	stdout: (text) => process.stdout.write(text),
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
		importGit: createImportGit(process.platform, process.env, process.cwd()),
		hookGit: createGitRunner({
			platform: process.platform,
			env: process.env,
			processCwd: process.cwd(),
			excludeTarget: true,
		}),
		sleep: (ms) => delay(ms),
		top: createProcessIo(),
		runOriginal: runOriginalCommand,
		spawnSender: spawnUsageSender,
		ask: async (question) => {
			const lines = createInterface({
				input: process.stdin,
				output: process.stdout,
			});
			try {
				return await lines.question(question);
			} finally {
				lines.close();
			}
		},
		readStdin: async (maxBytes) => {
			const chunks: Buffer[] = [];
			let size = 0;
			for await (const chunk of process.stdin) {
				chunks.push(chunk as Buffer);
				size += (chunk as Buffer).length;
				// 上限を超えたと分かれば、残りは読まない。
				if (size > maxBytes) break;
			}
			return Buffer.concat(chunks);
		},
	}));
