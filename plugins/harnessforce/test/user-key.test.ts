import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LookupFileSystem } from "@harnessforce/agent-core/process/lookup";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { describe, expect, it } from "vitest";
import { createUserKeyReader, type ExecHf, execHf } from "../src/user-key.js";

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

// memory上のfile。Windowsのfile systemと同じく大文字と小文字を区別しない。
function memoryFs(
	files: Record<string, string>,
	gitMarkers: string[] = [],
): LookupFileSystem {
	const lower = (path: string) => path.toLowerCase();
	const contents = new Map(
		Object.entries(files).map(([path, text]) => [lower(path), text]),
	);
	return {
		isFile: async (path) => contents.has(lower(path)),
		isExecutable: async () => true,
		exists: async (path) => gitMarkers.map(lower).includes(lower(path)),
		readSmallText: async (path) => contents.get(lower(path)),
		readHead: async (path) => contents.get(lower(path)),
	};
}

const reader = (
	options: Omit<Parameters<typeof createUserKeyReader>[0], "processCwd">,
	processCwd = "/claude-cwd",
) => createUserKeyReader({ processCwd, ...options });

describe("resolving hf on PATH", () => {
	it("starts npm's hf with the hook's node instead of env searching PATH", async () => {
		const { exec, calls } = fakeExec({ ok: true, stdout: header("k") });
		const read = reader({
			platform: "linux",
			env: { PATH: ":/usr/local/bin" },
			fs: memoryFs({ "/usr/local/bin/hf": "#!/usr/bin/env node\n" }),
			exec,
		});
		expect(await read("/work/web")).toEqual({ kind: "found", key: "k" });
		expect(calls).toEqual([
			{
				file: process.execPath,
				args: ["/usr/local/bin/hf", "otel-headers"],
				verbatim: false,
			},
		]);
	});

	it("runs hf from the first absolute PATH directory that has it", async () => {
		const { exec, calls } = fakeExec({ ok: true, stdout: header("k") });
		const read = reader({
			platform: "darwin",
			env: { PATH: "/usr/bin:relative/bin:/opt/hf/bin:/other/bin" },
			fs: memoryFs({
				"relative/bin/hf": "",
				"/opt/hf/bin/hf": "",
				"/other/bin/hf": "",
			}),
			exec,
		});
		expect(await read("/work/web")).toEqual({ kind: "found", key: "k" });
		// 相対pathのdirectoryはcwdで解決されるため探さない。
		expect(calls).toEqual([
			{ file: "/opt/hf/bin/hf", args: ["otel-headers"], verbatim: false },
		]);
	});

	it("skips the session's repository and the hook's own directory", async () => {
		const { exec, calls } = fakeExec({ ok: true, stdout: header("k") });
		const read = reader(
			{
				platform: "linux",
				env: { PATH: "/work/web/bin:/claude-cwd:/usr/local/bin" },
				fs: memoryFs(
					{
						"/work/web/bin/hf": "",
						"/claude-cwd/hf": "",
						"/usr/local/bin/hf": "",
					},
					["/work/web/.git"],
				),
				exec,
			},
			"/claude-cwd",
		);
		await read("/work/web/packages/app");
		expect(calls.map((call) => call.file)).toEqual(["/usr/local/bin/hf"]);
	});

	it("treats hf missing from PATH as missing without starting anything", async () => {
		const { exec, calls } = fakeExec({ ok: true, stdout: header("k") });
		const read = reader({
			platform: "linux",
			env: { PATH: "/usr/bin" },
			fs: memoryFs({}),
			exec,
		});
		expect(await read("/work/web")).toEqual({ kind: "missing" });
		expect(calls).toEqual([]);
	});

	describe("on Windows", () => {
		const npmDir = "C:\\Users\\John Doe\\AppData\\Roaming\\npm";
		const env = {
			PATH: `C:\\Windows;${npmDir}`,
			PATHEXT: ".COM;.EXE;.BAT;.CMD",
			ComSpec: "C:\\Windows\\system32\\cmd.exe",
			SystemRoot: "C:\\Windows",
		};
		const shim = [
			"@ECHO off",
			'IF EXIST "%dp0%\\node.exe" (',
			'  SET "_prog=%dp0%\\node.exe"',
			") ELSE (",
			'  SET "_prog=node"',
			")",
			'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & set PATHEXT=%PATHEXT:;.JS;=;% & "%_prog%"  "%dp0%\\node_modules\\@harnessforce\\cli\\dist\\bin.js" %*',
		].join("\r\n");

		it("starts an .exe directly, trying PATHEXT in order", async () => {
			const { exec, calls } = fakeExec({ ok: true, stdout: header("k") });
			const read = reader({
				platform: "win32",
				env,
				fs: memoryFs({ [`${npmDir}\\hf.exe`]: "", [`${npmDir}\\hf.cmd`]: "" }),
				exec,
			});
			expect(await read("C:\\work")).toEqual({ kind: "found", key: "k" });
			expect(calls).toEqual([
				{ file: `${npmDir}\\hf.EXE`, args: ["otel-headers"], verbatim: false },
			]);
		});

		it("starts npm's hf.cmd with the hook's node instead of cmd.exe or node on PATH", async () => {
			const { exec, calls } = fakeExec({ ok: true, stdout: header("k") });
			const read = reader({
				platform: "win32",
				env: { ...env, PATH: `C:\\repo;C:\\nodejs;${npmDir}` },
				fs: memoryFs(
					{
						[`${npmDir}\\hf.cmd`]: shim,
						"C:\\repo\\node.exe": "",
						"C:\\nodejs\\node.exe": "",
					},
					["C:\\repo\\.git"],
				),
				exec,
			});
			expect(await read("C:\\repo")).toEqual({ kind: "found", key: "k" });
			expect(calls).toEqual([
				{
					file: process.execPath,
					args: [
						`${npmDir}\\node_modules\\@harnessforce\\cli\\dist\\bin.js`,
						"otel-headers",
					],
					verbatim: false,
				},
			]);
		});

		it("starts another hf.cmd through cmd.exe with the path quoted twice", async () => {
			const { exec, calls } = fakeExec({ ok: true, stdout: header("k") });
			const read = reader({
				platform: "win32",
				env,
				fs: memoryFs({
					[`${npmDir}\\hf.cmd`]: "@echo off\r\nnode x.js %*\r\n",
				}),
				exec,
			});
			expect(await read("C:\\work")).toEqual({ kind: "found", key: "k" });
			expect(calls).toEqual([
				{
					file: "C:\\Windows\\system32\\cmd.exe",
					args: ["/d", "/s", "/c", `""${npmDir}\\hf.CMD" otel-headers"`],
					verbatim: true,
				},
			]);
		});

		it("uses SystemRoot's cmd.exe without ComSpec or with a relative one", async () => {
			for (const comSpec of [{}, { ComSpec: "cmd.exe" }]) {
				const { exec, calls } = fakeExec({ ok: true, stdout: header("k") });
				const read = reader({
					platform: "win32",
					env: {
						PATH: "C:\\tools",
						PATHEXT: ".BAT",
						SystemRoot: "C:\\Windows",
						...comSpec,
					},
					fs: memoryFs({ "C:\\tools\\hf.bat": "" }),
					exec,
				});
				await read("C:\\work");
				expect(calls[0]?.file).toBe("C:\\Windows\\System32\\cmd.exe");
				expect(calls[0]?.args.at(-1)).toBe(
					'""C:\\tools\\hf.BAT" otel-headers"',
				);
			}
		});

		it.each([
			"%",
			"!",
		])("does not start a .cmd whose path contains %s", async (mark) => {
			const { exec, calls } = fakeExec({ ok: true, stdout: header("k") });
			const dir = `C:\\a${mark}b\\npm`;
			const read = reader({
				platform: "win32",
				env: { PATH: dir, PATHEXT: ".CMD", SystemRoot: "C:\\Windows" },
				fs: memoryFs({ [`${dir}\\hf.cmd`]: "" }),
				exec,
			});
			expect(await read("C:\\work")).toEqual({ kind: "missing" });
			expect(calls).toEqual([]);
		});
	});
});

describe("reading the hf otel-headers output", () => {
	const readWith = (result: { ok: boolean; stdout: string }) =>
		reader({
			platform: "linux",
			env: { PATH: "/bin" },
			fs: memoryFs({ "/bin/hf": "" }),
			exec: fakeExec(result).exec,
		})("/work/web");

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

	const realReader = (dir: string) => {
		const read = createUserKeyReader({
			platform: process.platform,
			env: { PATH: dir, HARNESSFORCE_WORKSPACE_ID: "ws1" },
			exec: execHf,
			processCwd: "/nonexistent-cwd",
		});
		return () => read("/nonexistent-session");
	};

	it("passes the environment and reads the key", async () => {
		const dir = writeHf(
			'[ "$1" = otel-headers ] && printf \'{"Authorization":"Bearer hf_ik_%s_user"}\' "$HARNESSFORCE_WORKSPACE_ID"',
		);
		expect(await realReader(dir)()).toEqual({
			kind: "found",
			key: "hf_ik_ws1_user",
		});
	});

	it("gives up after 1 second", async () => {
		const dir = writeHf("sleep 5");
		const began = Date.now();
		expect(await realReader(dir)()).toEqual({ kind: "failed" });
		expect(Date.now() - began).toBeLessThan(3000);
	});

	// Windowsのcmd.exe経由と同じく、止めたprocessの子がstdoutを持ったまま残っても待たない。
	it("does not wait for a child that keeps stdout open after the limit", async () => {
		const dir = writeHf("sleep 5 &\nsleep 5");
		const began = Date.now();
		expect(await realReader(dir)()).toEqual({ kind: "failed" });
		expect(Date.now() - began).toBeLessThan(3000);
	});

	it("ignores a non-executable hf", async () => {
		const dir = tempDir("hf-bin-");
		writeFileSync(join(dir, "hf"), "#!/bin/sh\n");
		expect(await realReader(dir)()).toEqual({ kind: "missing" });
	});
});
