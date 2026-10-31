import { type ChildProcess, spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
	it.each(["init", "run", "import", "hook"])(
		"relaunches harnessforce %s and ends with the relaunched exit code",
		async (command) => {
			const seen: Record<string, string>[] = [];
			const err: string[] = [];
			const out: string[] = [];
			const code = await relaunchHf([command], {
				platform: "linux",
				env: { HTTPS_PROXY: "http://p", PATH: "/usr/bin" },
				spawnSelf: exitingWith(7, seen),
				stdout: (text) => out.push(text),
				stderr: (text) => err.push(text),
			});
			expect(code).toBe(7);
			expect(seen[0]?.HTTPS_PROXY).toBeUndefined();
			expect(JSON.parse(seen[0]?.HARNESSFORCE_RUNTIME_ENV ?? "")).toEqual({
				HTTPS_PROXY: "http://p",
			});
			expect(err).toEqual([]);
		},
	);

	it.each([
		["tune"],
		["tune", "--json"],
		["tune", "--all", "--show-report"],
		["tune", "--report-only"],
	])("relaunches harnessforce %j", async (...argv) => {
		const seen: Record<string, string>[] = [];
		const code = await relaunchHf(argv, {
			platform: "linux",
			env: { NODE_OPTIONS: "--x" },
			spawnSelf: exitingWith(0, seen),
			stdout: () => {},
			stderr: () => {},
		});
		expect(code).toBe(0);
		expect(seen[0]?.NODE_OPTIONS).toBeUndefined();
	});

	// tokenやkeyを送るcommandを足したとき、起動し直す集合へ入れ忘れると、TLSとproxyの変数を受け継いだまま送る。
	const src = fileURLToPath(new URL("../src/", import.meta.url));
	const sendingDirs = readdirSync(src, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && entry.name !== "credentials")
		.map((entry) => entry.name)
		.filter((dir) =>
			readdirSync(join(src, dir), { recursive: true, encoding: "utf8" })
				.filter((file) => file.endsWith(".ts"))
				.some((file) =>
					/\b(verifyCliAccess|createApiTokenSession)\b/.test(
						readFileSync(join(src, dir, file), "utf8"),
					),
				),
		);
	it("finds the commands that send an ApiToken", () => {
		expect(sendingDirs.sort()).toEqual(["import", "run", "status", "tune"]);
	});
	it.each(sendingDirs)(
		"relaunches harnessforce %s, which sends an ApiToken",
		async (command) => {
			expect(
				await relaunchHf([command], {
					platform: "linux",
					env: { NODE_OPTIONS: "--x" },
					spawnSelf: exitingWith(0),
					stdout: () => {},
					stderr: () => {},
				}),
			).toBe(0);
		},
	);

	// tuneの`record`、`--purge`、`--no-send`を付けた分析、誤った引数は通信を行わない。
	it.each([
		["otel-headers"],
		["tune", "record"],
		["tune", "--purge"],
		["tune", "--print-schedule"],
		["tune", "--no-send"],
		["tune", "--json", "--no-send"],
		["tune", "--unknown"],
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
				stdout: () => {},
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
				stdout: () => {},
				stderr: () => {},
			}),
		).toBeUndefined();
	});

	it("ends with the restart message when the relaunch fails", async () => {
		const err: string[] = [];
		const out: string[] = [];
		const code = await relaunchHf(["import"], {
			platform: "linux",
			env: { NODE_EXTRA_CA_CERTS: "/x.pem" },
			spawnSelf: () => {
				throw new Error("EAGAIN");
			},
			stdout: (text) => out.push(text),
			stderr: (text) => err.push(text),
		});
		expect(code).toBe(1);
		expect(err).toEqual(["Could not restart harnessforce\n"]);
	});

	// correlation.md「hook」: hookはどの失敗でもsessionを止めず、常にexit 0で終える。
	it("lets the hook skip with exit 0 when the relaunch fails", async () => {
		const err: string[] = [];
		const out: string[] = [];
		const code = await relaunchHf(["hook", "session-start"], {
			platform: "linux",
			env: { NODE_EXTRA_CA_CERTS: "/x.pem" },
			spawnSelf: () => {
				throw new Error("EAGAIN");
			},
			stdout: (text) => out.push(text),
			stderr: (text) => err.push(text),
		});
		expect(code).toBe(0);
		expect(err).toEqual([
			"harnessforce: session registration skipped (restart failed)\n",
		]);
		// correlation.md「hookの警告」: Codexのhookは平文の警告1行だけを出す。
		expect(out).toEqual(["Could not restart the Harnessforce hook\n"]);
	});
});
