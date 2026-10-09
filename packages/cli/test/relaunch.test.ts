import { type ChildProcess, spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { relaunchHf } from "../src/relaunch.js";

// 起動し直したprocessの代わりに、終了コードを返すだけのNode.jsを起動する。
const exitingWith =
	(code: number, seen: Record<string, string>[] = []) =>
	(env: Record<string, string>): ChildProcess => {
		seen.push(env);
		return spawn(process.execPath, ["-e", `process.exit(${code})`], { env });
	};

describe("relaunching harnessforce without Node runtime variables", () => {
	it.each([
		"init",
		"run",
		"import",
	])("relaunches harnessforce %s and ends with the relaunched exit code", async (command) => {
		const seen: Record<string, string>[] = [];
		const err: string[] = [];
		const code = await relaunchHf([command], {
			platform: "linux",
			env: { HTTPS_PROXY: "http://p", PATH: "/usr/bin" },
			spawnSelf: exitingWith(7, seen),
			stderr: (text) => err.push(text),
		});
		expect(code).toBe(7);
		expect(seen[0]?.HTTPS_PROXY).toBeUndefined();
		expect(JSON.parse(seen[0]?.HARNESSFORCE_RUNTIME_ENV ?? "")).toEqual({
			HTTPS_PROXY: "http://p",
		});
		expect(err).toEqual([]);
	});

	it.each([
		["otel-headers"],
		["--version"],
		[],
	])("does not relaunch %j", async (...argv) => {
		expect(
			await relaunchHf(argv.flat(), {
				platform: "linux",
				env: { NODE_OPTIONS: "--x" },
				spawnSelf: () => {
					throw new Error("must not relaunch");
				},
				stderr: () => {},
			}),
		).toBeUndefined();
	});

	it("continues in the same process without runtime variables", async () => {
		expect(
			await relaunchHf(["init"], {
				platform: "linux",
				env: { PATH: "/usr/bin" },
				spawnSelf: () => {
					throw new Error("must not relaunch");
				},
				stderr: () => {},
			}),
		).toBeUndefined();
	});

	it("ends with the restart message when the relaunch fails", async () => {
		const err: string[] = [];
		const code = await relaunchHf(["import"], {
			platform: "linux",
			env: { NODE_EXTRA_CA_CERTS: "/x.pem" },
			spawnSelf: () => {
				throw new Error("EAGAIN");
			},
			stderr: (text) => err.push(text),
		});
		expect(code).toBe(1);
		expect(err).toEqual(["harnessforceを起動し直せませんでした\n"]);
	});
});
