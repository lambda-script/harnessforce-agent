import { type ChildProcess, spawn } from "node:child_process";
import { constants } from "node:os";
import type { Env } from "../types.js";

// correlation.md「Node.jsの実行時の変数」。NODE_EXTRA_CA_CERTSとNODE_OPTIONSは起動時にだけ読まれ、
// 起動後に消しても効果が残るため、これらを除いた環境で自身をもう1度起動する。
const RUNTIME_VARIABLES = [
	"NODE_TLS_REJECT_UNAUTHORIZED",
	"NODE_EXTRA_CA_CERTS",
	"NODE_OPTIONS",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
	"http_proxy",
	"https_proxy",
	"no_proxy",
	// OpenSSLの設定fileはproviderの共有libraryを読み込め、SSL_CERT_*は信頼するCAを置き換える。
	"OPENSSL_CONF",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
];
// 取り除いた値を、起動し直したhfへ渡す変数。agentとブラウザの環境へ戻すためだけに使う。
const STASH = "HARNESSFORCE_RUNTIME_ENV";
// 端末からのCtrl-Cは起動し直したprocessも受け取る。そちらが扱うため、元のprocessは終わらずに待つ。
const IGNORED_WHILE_WAITING = ["SIGINT", "SIGQUIT"] as const;
// 元のprocessだけに届いた終了の要求は、起動し直したprocessへ渡す。
const FORWARDED = ["SIGTERM", "SIGHUP"] as const;

const isRuntimeVariable = (name: string, platform: NodeJS.Platform) =>
	platform === "win32"
		? RUNTIME_VARIABLES.some((v) => v.toUpperCase() === name.toUpperCase())
		: RUNTIME_VARIABLES.includes(name);

export function splitRuntimeEnv(
	env: Env,
	platform: NodeJS.Platform,
): { clean: Record<string, string>; removed: Record<string, string> } {
	const clean: Record<string, string> = {};
	const removed: Record<string, string> = {};
	for (const [name, value] of Object.entries(env)) {
		if (value === undefined) continue;
		if (isRuntimeVariable(name, platform)) removed[name] = value;
		else clean[name] = value;
	}
	return { clean, removed };
}

export type Relaunch =
	| { kind: "not-needed" }
	| { kind: "exited"; code: number }
	| { kind: "failed" };

export type SpawnSelf = (env: Record<string, string>) => ChildProcess;

// 同じNode.jsの実行file、同じscriptと引数、同じstdin、stdout、stderrで起動する。
export const spawnSelf: SpawnSelf = (env) =>
	spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
		env,
		stdio: "inherit",
	});

type RelaunchOptions = {
	platform: NodeJS.Platform;
	env: Env;
	// hfだけが、取り除いた値をagentとブラウザの環境へ戻すために受け渡す。
	stash: boolean;
	spawnSelf: SpawnSelf;
};

export function relaunchWithoutRuntimeVariables({
	platform,
	env,
	stash,
	spawnSelf: start,
}: RelaunchOptions): Promise<Relaunch> {
	const { clean, removed } = splitRuntimeEnv(env, platform);
	if (Object.keys(removed).length === 0)
		return Promise.resolve({ kind: "not-needed" });
	const childEnv = Object.fromEntries(
		Object.entries(clean).filter(([name]) => name !== STASH),
	);
	if (stash) childEnv[STASH] = JSON.stringify(removed);
	return new Promise((resolve) => {
		let child: ChildProcess;
		try {
			child = start(childEnv);
		} catch {
			return resolve({ kind: "failed" });
		}
		const ignore = () => {};
		const forward = (signal: NodeJS.Signals) => child.kill(signal);
		for (const signal of IGNORED_WHILE_WAITING) process.on(signal, ignore);
		for (const signal of FORWARDED) process.on(signal, forward);
		const finish = (outcome: Relaunch) => {
			for (const signal of IGNORED_WHILE_WAITING) process.off(signal, ignore);
			for (const signal of FORWARDED) process.off(signal, forward);
			resolve(outcome);
		};
		child.once("error", () => finish({ kind: "failed" }));
		child.once("exit", (code, signal) =>
			finish({
				kind: "exited",
				code: code ?? 128 + (signal ? constants.signals[signal] : 0),
			}),
		);
	});
}

// 起動し直したhfが受け取った値。processの環境から取り除き、実行時の変数の名前の文字列だけを返す。
export function takeStashedRuntimeEnv(
	env: NodeJS.ProcessEnv,
	platform: NodeJS.Platform,
): Record<string, string> {
	const raw = env[STASH];
	delete env[STASH];
	if (raw === undefined) return {};
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return {};
	}
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return {};
	return Object.fromEntries(
		Object.entries(value).filter(
			(entry): entry is [string, string] =>
				typeof entry[1] === "string" && isRuntimeVariable(entry[0], platform),
		),
	);
}
