import type { RunGit } from "@harnessforce/agent-core/process/git";
import type { Env } from "@harnessforce/agent-core/types";
import {
	ConfigSnapshotSchema,
	SessionRegistrationSchema,
} from "@harnessforce/semconv";
import { managedDir } from "@harnessforce/test-support/managed-dir";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { compileSchema } from "@harnessforce/test-support/validator";
import type { HookDeps } from "../src/hook.js";
import type { UserKeyRead } from "../src/user-key.js";

// 送信内容を、本体が検証に使う公開schemaで確かめる。
export const isRegistration = compileSchema(SessionRegistrationSchema);
export const isConfigSnapshot = compileSchema(ConfigSnapshotSchema);

export const REPO = {
	cwd: "/work/web",
	remote: "git@github.com:Acme/Web.git",
	branch: "eng-42-login",
	commit: "3f786850e387550fdab836ed7e6dc881de23001b",
};

// overridesは呼び出しのたびに読むため、testの途中で書き換えるとgitの状態の変化を表せる。
export function fakeGit(
	overrides: Record<string, string | undefined> = {},
): RunGit {
	const defaults: Record<string, string | undefined> = {
		"rev-parse --is-inside-work-tree": "true",
		remote: "origin",
		"remote get-url origin": REPO.remote,
		"symbolic-ref --quiet --short HEAD": REPO.branch,
		"rev-parse --verify --quiet HEAD": REPO.commit,
	};
	return async (cwd, args) => {
		if (cwd !== REPO.cwd) return undefined;
		const key = args.join(" ");
		return key in overrides ? overrides[key] : defaults[key];
	};
}

type HarnessOptions = {
	status?: number;
	// URLごとに応答のstatusを変える。無ければstatusを使う。
	statusFor?: (url: string) => number | undefined;
	homeDir?: string;
	env?: Env;
	git?: RunGit;
	fetchError?: Error;
	// `harnessforce otel-headers`でkeychainを読んだ結果。無ければ`harnessforce`がPATHに無い場合とする。
	userKey?: UserKeyRead;
	// managed-settings.jsonのenv。既定のWorkspace用のkeyと送信先に重ね、undefinedの値は除く。nullならfileを置かない。
	managed?: Env | null;
};

// managed settingsのfileが配るWorkspace用のkeyと送信先。
export const MANAGED_ENV = {
	HARNESSFORCE_ENDPOINT: "https://ingest.example.test",
	HARNESSFORCE_INGEST_KEY: "hf_ik_ws1_secret",
};

const withoutUndefined = (env: Env) =>
	Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined));

export function harness(options: HarnessOptions = {}) {
	const requests: { url: string; init: RequestInit }[] = [];
	const out: string[] = [];
	const err: string[] = [];
	let userKeyReads = 0;
	const deps: HookDeps = {
		// processの環境変数。repositoryのsettingsが書けるため、Workspace用のkeyには使われない。
		env: { ...options.env },
		now: () => new Date("2026-09-26T00:00:00Z"),
		// 既定では存在しないdirectoryを指し、構成が0件（snapshotを送らない）になる。
		homeDir: options.homeDir ?? "/nonexistent/hf-home",
		managedDir: managedDir(
			options.managed === null
				? null
				: { env: withoutUndefined({ ...MANAGED_ENV, ...options.managed }) },
		),
		git: options.git ?? fakeGit(),
		fetch: async (url, init) => {
			requests.push({ url: url.href, init });
			if (options.fetchError) throw options.fetchError;
			const status = options.statusFor?.(url.href) ?? options.status ?? 200;
			return new Response(null, { status });
		},
		stdout: (text) => out.push(text),
		stderr: (text) => err.push(text),
		readUserKey: async () => {
			userKeyReads += 1;
			return options.userKey ?? { kind: "missing" };
		},
	};
	return {
		deps,
		requests,
		userKeyReads: () => userKeyReads,
		bodies: () =>
			requests.map((r) => JSON.parse(String(r.init.body)) as unknown[]),
		bodiesTo: (path: string) =>
			requests
				.filter((r) => new URL(r.url).pathname.endsWith(path))
				.map((r) => JSON.parse(String(r.init.body)) as unknown[]),
		out: () => out.join(""),
		err: () => err.join(""),
	};
}

export type Harness = ReturnType<typeof harness>;

export const scratchpad = () => tempDir("hf-scratch-");

// correlation.md「session context」: SessionStartのstdoutへ出す唯一のJSONのobject。401ではsystemMessageを加える。
export const sessionContext = (
	extra: { systemMessage?: string } = {},
	sessionId = "s-1",
) => ({
	hookSpecificOutput: {
		hookEventName: "SessionStart",
		additionalContext: `harnessforce session_id: ${sessionId}`,
	},
	...extra,
});
export const sessionContextLine = (
	extra: { systemMessage?: string } = {},
	sessionId = "s-1",
) => `${JSON.stringify(sessionContext(extra, sessionId))}\n`;
