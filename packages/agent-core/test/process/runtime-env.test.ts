import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
	relaunchWithoutRuntimeVariables,
	splitRuntimeEnv,
	takeStashedRuntimeEnv,
} from "../../src/process/runtime-env.js";

const RUNTIME = {
	NODE_TLS_REJECT_UNAUTHORIZED: "0",
	NODE_EXTRA_CA_CERTS: "/repo/evil.pem",
	NODE_OPTIONS: "--use-openssl-ca",
	HTTP_PROXY: "http://proxy.example:8080",
	HTTPS_PROXY: "http://proxy.example:8080",
	NO_PROXY: "*",
	http_proxy: "http://proxy.example:8080",
	https_proxy: "http://proxy.example:8080",
	no_proxy: "*",
	OPENSSL_CONF: "/repo/openssl.cnf",
	SSL_CERT_FILE: "/repo/ca.pem",
	SSL_CERT_DIR: "/repo/certs",
};

describe("splitting the runtime variables", () => {
	it("removes every runtime variable, even with an empty value", () => {
		expect(
			splitRuntimeEnv(
				{ ...RUNTIME, NODE_OPTIONS: "", PATH: "/usr/bin" },
				"linux",
			),
		).toEqual({
			clean: { PATH: "/usr/bin" },
			removed: { ...RUNTIME, NODE_OPTIONS: "" },
		});
	});

	it("matches names exactly outside Windows and without case on Windows", () => {
		const env = { Https_Proxy: "http://p", Node_Options: "--x" };
		expect(splitRuntimeEnv(env, "darwin").removed).toEqual({});
		expect(splitRuntimeEnv(env, "win32").removed).toEqual(env);
	});
});

// 起動したprocessの代わり。exitまたはerrorを後から起こす。
function fakeChild() {
	const child = new EventEmitter() as EventEmitter & { kill: () => boolean };
	child.kill = () => true;
	return child as unknown as ChildProcess & EventEmitter;
}

describe("relaunching without the runtime variables", () => {
	it("does not relaunch when no runtime variable is set", async () => {
		const outcome = await relaunchWithoutRuntimeVariables({
			platform: "linux",
			env: { PATH: "/usr/bin" },
			stash: true,
			spawnSelf: () => {
				throw new Error("must not relaunch");
			},
		});
		expect(outcome).toEqual({ kind: "not-needed" });
	});

	it("relaunches with the clean environment and stashes the removed values for hf", async () => {
		const envs: Record<string, string>[] = [];
		const child = fakeChild();
		const outcome = relaunchWithoutRuntimeVariables({
			platform: "linux",
			env: { PATH: "/usr/bin", HTTPS_PROXY: "http://p", NODE_OPTIONS: "--x" },
			stash: true,
			spawnSelf: (env) => {
				envs.push(env);
				return child;
			},
		});
		child.emit("exit", 3, null);
		expect(await outcome).toEqual({ kind: "exited", code: 3 });
		expect(envs).toHaveLength(1);
		const [env] = envs;
		expect(env?.PATH).toBe("/usr/bin");
		expect(env?.HTTPS_PROXY).toBeUndefined();
		expect(env?.NODE_OPTIONS).toBeUndefined();
		expect(JSON.parse(env?.HARNESSFORCE_RUNTIME_ENV ?? "")).toEqual({
			HTTPS_PROXY: "http://p",
			NODE_OPTIONS: "--x",
		});
	});

	it("does not stash the removed values for the hook", async () => {
		const envs: Record<string, string>[] = [];
		const child = fakeChild();
		const outcome = relaunchWithoutRuntimeVariables({
			platform: "linux",
			env: { HTTPS_PROXY: "http://p", HARNESSFORCE_RUNTIME_ENV: "{}" },
			stash: false,
			spawnSelf: (env) => {
				envs.push(env);
				return child;
			},
		});
		child.emit("exit", 0, null);
		await outcome;
		expect(envs[0]).toEqual({});
	});

	it("ends with 128 plus the signal number when the relaunched process is killed", async () => {
		const child = fakeChild();
		const outcome = relaunchWithoutRuntimeVariables({
			platform: "linux",
			env: { NODE_OPTIONS: "--x" },
			stash: true,
			spawnSelf: () => child,
		});
		child.emit("exit", null, "SIGTERM");
		expect(await outcome).toEqual({ kind: "exited", code: 143 });
	});

	it.each([
		["the spawn throws", "throw"],
		["the child emits an error", "error"],
	])("fails when %s", async (_name, how) => {
		const child = fakeChild();
		const outcome = relaunchWithoutRuntimeVariables({
			platform: "linux",
			env: { NODE_OPTIONS: "--x" },
			stash: true,
			spawnSelf: () => {
				if (how === "throw") throw new Error("spawn failed");
				return child;
			},
		});
		if (how === "error") child.emit("error", new Error("ENOENT"));
		expect(await outcome).toEqual({ kind: "failed" });
	});

	it("gives a real Node.js process an environment without the runtime variables", async () => {
		let stdout = "";
		const outcome = await relaunchWithoutRuntimeVariables({
			platform: process.platform,
			env: { ...RUNTIME, NODE_OPTIONS: "", PATH: process.env.PATH ?? "" },
			stash: true,
			spawnSelf: (env) => {
				const child = spawn(
					process.execPath,
					[
						"-e",
						"process.stdout.write(JSON.stringify(Object.keys(process.env)))",
					],
					{ env, stdio: ["ignore", "pipe", "inherit"] },
				);
				child.stdout?.on("data", (chunk) => {
					stdout += chunk;
				});
				return child;
			},
		});
		expect(outcome).toEqual({ kind: "exited", code: 0 });
		const names: string[] = JSON.parse(stdout);
		for (const name of Object.keys(RUNTIME))
			expect(names.map((n) => n.toUpperCase())).not.toContain(
				name.toUpperCase(),
			);
		expect(names).toContain("HARNESSFORCE_RUNTIME_ENV");
	});
});

describe("taking the stashed runtime variables", () => {
	it("returns the stashed runtime variables and removes the stash", () => {
		const env: NodeJS.ProcessEnv = {
			HARNESSFORCE_RUNTIME_ENV: JSON.stringify({
				HTTPS_PROXY: "http://p",
				NODE_EXTRA_CA_CERTS: "/etc/corp.pem",
				PATH: "/evil",
				NODE_OPTIONS: 1,
			}),
			PATH: "/usr/bin",
		};
		expect(takeStashedRuntimeEnv(env, "linux")).toEqual({
			HTTPS_PROXY: "http://p",
			NODE_EXTRA_CA_CERTS: "/etc/corp.pem",
		});
		expect(env).toEqual({ PATH: "/usr/bin" });
	});

	it.each([
		["no stash", {}],
		["invalid JSON", { HARNESSFORCE_RUNTIME_ENV: "{" }],
		["a non-object", { HARNESSFORCE_RUNTIME_ENV: "[1]" }],
	])("returns nothing for %s", (_name, env: NodeJS.ProcessEnv) => {
		expect(takeStashedRuntimeEnv(env, "linux")).toEqual({});
		expect(env.HARNESSFORCE_RUNTIME_ENV).toBeUndefined();
	});
});
