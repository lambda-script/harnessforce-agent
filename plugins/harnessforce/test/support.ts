import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionRegistrationSchema } from "../../../packages/semconv/src/schemas/session-registration.js";
import { compile } from "../../../packages/semconv/test/support/validator.js";
import type { Env } from "../src/destination.js";
import type { HookDeps } from "../src/hook.js";
import type { RunGit } from "../src/vcs.js";

export const isRegistration = compile(SessionRegistrationSchema);

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
		git: options.git ?? fakeGit(),
		fetch: async (url, init) => {
			requests.push({ url: url.href, init });
			if (options.fetchError) throw options.fetchError;
			return new Response(null, { status: options.status ?? 200 });
		},
		stdout: (text) => out.push(text),
		stderr: (text) => err.push(text),
	};
	return {
		deps,
		requests,
		bodies: () =>
			requests.map((r) => JSON.parse(String(r.init.body)) as unknown[]),
		out: () => out.join(""),
		err: () => err.join(""),
	};
}

export type Harness = ReturnType<typeof harness>;

export const scratchpad = () => mkdtempSync(join(tmpdir(), "hf-scratch-"));
