import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ajv } from "ajv";
import { fullFormats } from "ajv-formats/dist/formats.js";
import { onTestFinished } from "vitest";
import { ConfigSnapshotSchema } from "../../../packages/semconv/src/schemas/config-snapshot.js";
import { SessionRegistrationSchema } from "../../../packages/semconv/src/schemas/session-registration.js";
import type { Env } from "../src/destination.js";
import type { HookDeps } from "../src/hook.js";
import type { RunGit } from "../src/vcs.js";

// 送信内容を、本体が検証に使う公開schemaで確かめる。
const ajv = new Ajv({ strict: true, allErrors: true });
ajv.addFormat("date-time", fullFormats["date-time"]);
const validator = (schema: object) => {
	const validate = ajv.compile(JSON.parse(JSON.stringify(schema)));
	return (value: unknown) => validate(value);
};
export const isRegistration = validator(SessionRegistrationSchema);
export const isConfigSnapshot = validator(ConfigSnapshotSchema);

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
};

export function harness(options: HarnessOptions = {}) {
	const requests: { url: string; init: RequestInit }[] = [];
	const out: string[] = [];
	const err: string[] = [];
	const deps: HookDeps = {
		env: {
			HARNESSFORCE_ENDPOINT: "https://ingest.example.test",
			HARNESSFORCE_INGEST_KEY: "hf_ik_ws1_secret",
			...options.env,
		},
		now: () => new Date("2026-09-26T00:00:00Z"),
		// 既定では存在しないdirectoryを指し、構成が0件（snapshotを送らない）になる。
		homeDir: options.homeDir ?? "/nonexistent/hf-home",
		managedDir: "/nonexistent/hf-managed",
		git: options.git ?? fakeGit(),
		fetch: async (url, init) => {
			requests.push({ url: url.href, init });
			if (options.fetchError) throw options.fetchError;
			const status = options.statusFor?.(url.href) ?? options.status ?? 200;
			return new Response(null, { status });
		},
		stdout: (text) => out.push(text),
		stderr: (text) => err.push(text),
	};
	return {
		deps,
		requests,
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

// testの終了時に削除する一時directory。testの中でだけ呼ぶ。
export function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

export const scratchpad = () => tempDir("hf-scratch-");
