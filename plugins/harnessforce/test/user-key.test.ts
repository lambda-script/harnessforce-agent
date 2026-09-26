import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createUserKeyReader,
	type ExecHf,
	execHf,
	type IsRunnable,
} from "../src/user-key.js";
import { tempDir } from "./support.js";

type Call = { file: string; args: readonly string[]; verbatim: boolean };

const header = (key: string) =>
	JSON.stringify({ Authorization: `Bearer ${key}` });

function fakeExec(result: { ok: boolean; stdout: string }) {
	const calls: Call[] = [];
	const exec: ExecHf = async (file, args, options) => {
		calls.push({ file, args, verbatim: options.windowsVerbatimArguments });
		expect(options.timeoutMs).toBe(1000);
		return result;
	};
	return { exec, calls };
}

const runnable =
	(...paths: string[]): IsRunnable =>
	async (path) =>
		paths.includes(path);

describe("resolving hf on PATH", () => {
	it("runs hf from the first PATH directory that has it", async () => {
		const { exec, calls } = fakeExec({ ok: true, stdout: header("k") });
		const read = createUserKeyReader({
			platform: "darwin",
			env: { PATH: "/usr/bin:relative/bin:/opt/hf/bin:/other/bin" },
			isRunnable: runnable(
				"relative/bin/hf",
				"/opt/hf/bin/hf",
				"/other/bin/hf",
			),
			exec,
		});
		expect(await read()).toEqual({ kind: "found", key: "k" });
		// 相対pathのdirectoryはcwdで解決されるため探さない。
		expect(calls).toEqual([
			{ file: "/opt/hf/bin/hf", args: ["otel-headers"], verbatim: false },
		]);
	});

	it("treats hf missing from PATH as missing without starting anything", async () => {
		const { exec, calls } = fakeExec({ ok: true, stdout: header("k") });
		const read = createUserKeyReader({
			platform: "linux",
			env: { PATH: "/usr/bin" },
			isRunnable: runnable(),
			exec,
		});
		expect(await read()).toEqual({ kind: "missing" });
		expect(calls).toEqual([]);
	});

	describe("on Windows", () => {
		const npmDir = "C:\\Users\\John Doe\\AppData\\Roaming\\npm";
		const env = {
			PATH: `C:\\Windows;${npmDir}`,
			PATHEXT: ".COM;.EXE;.BAT;.CMD",
			ComSpec: "C:\\Windows\\system32\\cmd.exe",
		};

		it("starts an .exe directly, trying PATHEXT in order", async () => {
			const { exec, calls } = fakeExec({ ok: true, stdout: header("k") });
			const read = createUserKeyReader({
				platform: "win32",
				env,
				isRunnable: runnable(`${npmDir}\\hf.EXE`, `${npmDir}\\hf.CMD`),
				exec,
			});
			expect(await read()).toEqual({ kind: "found", key: "k" });
			expect(calls).toEqual([
				{ file: `${npmDir}\\hf.EXE`, args: ["otel-headers"], verbatim: false },
			]);
		});

		it("starts hf.cmd through cmd.exe with the path quoted twice", async () => {
			const { exec, calls } = fakeExec({ ok: true, stdout: header("k") });
			const read = createUserKeyReader({
				platform: "win32",
				env,
				isRunnable: runnable(`${npmDir}\\hf.CMD`),
				exec,
			});
			expect(await read()).toEqual({ kind: "found", key: "k" });
			expect(calls).toEqual([
				{
					file: "C:\\Windows\\system32\\cmd.exe",
					args: ["/d", "/s", "/c", `""${npmDir}\\hf.CMD" otel-headers"`],
					verbatim: true,
				},
			]);
		});

		it("falls back to cmd.exe without ComSpec and resolves .bat", async () => {
			const { exec, calls } = fakeExec({ ok: true, stdout: header("k") });
			const read = createUserKeyReader({
				platform: "win32",
				env: { PATH: "C:\\tools", PATHEXT: ".BAT" },
				isRunnable: runnable("C:\\tools\\hf.BAT"),
				exec,
			});
			await read();
			expect(calls[0]?.file).toBe("cmd.exe");
			expect(calls[0]?.args.at(-1)).toBe('""C:\\tools\\hf.BAT" otel-headers"');
		});

		it("does not start a .cmd whose path contains %", async () => {
			const { exec, calls } = fakeExec({ ok: true, stdout: header("k") });
			const read = createUserKeyReader({
				platform: "win32",
				env: { PATH: "C:\\%USERNAME%\\npm", PATHEXT: ".CMD" },
				isRunnable: runnable("C:\\%USERNAME%\\npm\\hf.CMD"),
				exec,
			});
			expect(await read()).toEqual({ kind: "missing" });
			expect(calls).toEqual([]);
		});
	});
});

describe("reading the hf otel-headers output", () => {
	const readWith = (result: { ok: boolean; stdout: string }) =>
		createUserKeyReader({
			platform: "linux",
			env: { PATH: "/bin" },
			isRunnable: runnable("/bin/hf"),
			exec: fakeExec(result).exec,
		})();

	it.each([
		["a non-zero exit or timeout", { ok: false, stdout: header("k") }],
		["output that is not JSON", { ok: true, stdout: "Bearer k" }],
		["a JSON array", { ok: true, stdout: "[]" }],
		["another header", { ok: true, stdout: '{"X-Key":"Bearer k"}' }],
		["a non-Bearer value", { ok: true, stdout: '{"Authorization":"Basic k"}' }],
		["an empty key", { ok: true, stdout: '{"Authorization":"Bearer "}' }],
	])("reports %s as a failed read", async (_, result) =>
		expect(await readWith(result)).toEqual({ kind: "failed" }));
});

describe.skipIf(process.platform === "win32")("starting a real hf", () => {
	function writeHf(body: string): string {
		const dir = tempDir("hf-bin-");
		const hf = join(dir, "hf");
		writeFileSync(hf, `#!/bin/sh\n${body}\n`);
		chmodSync(hf, 0o755);
		return dir;
	}

	const reader = (dir: string) =>
		createUserKeyReader({
			platform: process.platform,
			env: { PATH: dir, HARNESSFORCE_WORKSPACE_ID: "ws1" },
			exec: execHf,
		});

	it("passes the environment and reads the key", async () => {
		const dir = writeHf(
			'[ "$1" = otel-headers ] && printf \'{"Authorization":"Bearer hf_ik_%s_user"}\' "$HARNESSFORCE_WORKSPACE_ID"',
		);
		expect(await reader(dir)()).toEqual({
			kind: "found",
			key: "hf_ik_ws1_user",
		});
	});

	it("gives up after 1 second", async () => {
		const dir = writeHf("sleep 5");
		const began = Date.now();
		expect(await reader(dir)()).toEqual({ kind: "failed" });
		expect(Date.now() - began).toBeLessThan(3000);
	});

	it("ignores a non-executable hf", async () => {
		const dir = tempDir("hf-bin-");
		writeFileSync(join(dir, "hf"), "#!/bin/sh\n");
		expect(await reader(dir)()).toEqual({ kind: "missing" });
	});
});
