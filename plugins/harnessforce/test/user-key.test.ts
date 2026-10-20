import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LookupFileSystem } from "@harnessforce/agent-core/process/lookup";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { describe, expect, it } from "vitest";
import { createUserKeyReader, type ExecHf, execHf } from "../src/user-key.js";

type Call = { file: string; args: readonly string[]; verbatim: boolean };

const header = (key: string) =>
	JSON.stringify({ Authorization: `Bearer ${key}` });

type ExecResult = Awaited<ReturnType<ExecHf>>;

function fakeExec(result: ExecResult) {
	const calls: Call[] = [];
	const envs: Record<string, string | undefined>[] = [];
	const exec: ExecHf = async (file, args, options) => {
		calls.push({ file, args, verbatim: options.windowsVerbatimArguments });
		envs.push(options.env);
		expect(options.timeoutMs).toBe(1000);
		return result;
	};
	return { exec, calls, envs };
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

describe("resolving harnessforce on PATH", () => {
	it("starts npm's harnessforce with the hook's node instead of env searching PATH", async () => {
		const { exec, calls } = fakeExec({ ok: true, stdout: header("k") });
		const read = reader({
			platform: "linux",
			env: { PATH: ":/usr/local/bin" },
			fs: memoryFs({ "/usr/local/bin/harnessforce": "#!/usr/bin/env node\n" }),
			exec,
		});
		expect(await read("/work/web")).toEqual({ kind: "found", key: "k" });
		expect(calls).toEqual([
			{
				file: process.execPath,
				args: ["/usr/local/bin/harnessforce", "otel-headers"],
				verbatim: false,
			},
		]);
	});

	it("runs harnessforce from the first absolute PATH directory that has it", async () => {
		const { exec, calls } = fakeExec({ ok: true, stdout: header("k") });
		const read = reader({
			platform: "darwin",
			env: { PATH: "/usr/bin:relative/bin:/opt/hf/bin:/other/bin" },
			fs: memoryFs({
				"relative/bin/harnessforce": "",
				"/opt/hf/bin/harnessforce": "",
				"/other/bin/harnessforce": "",
			}),
			exec,
		});
		expect(await read("/work/web")).toEqual({ kind: "found", key: "k" });
		// 相対pathのdirectoryはcwdで解決されるため探さない。
		expect(calls).toEqual([
			{
				file: "/opt/hf/bin/harnessforce",
				args: ["otel-headers"],
				verbatim: false,
			},
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
						"/work/web/bin/harnessforce": "",
						"/claude-cwd/harnessforce": "",
						"/usr/local/bin/harnessforce": "",
					},
					["/work/web/.git"],
				),
				exec,
			},
			"/claude-cwd",
		);
		await read("/work/web/packages/app");
		expect(calls.map((call) => call.file)).toEqual([
			"/usr/local/bin/harnessforce",
		]);
	});

	it("treats harnessforce missing from PATH as missing without starting anything", async () => {
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

	// correlation.md「コマンド名」: `hf`はHugging Face CLIの名前であり、公開するpackageは持たないため解決しない。
	it("does not resolve hf, which belongs to the Hugging Face CLI", async () => {
		const { exec, calls } = fakeExec({ ok: true, stdout: header("k") });
		const read = reader({
			platform: "linux",
			env: { PATH: "/usr/local/bin" },
			fs: memoryFs({ "/usr/local/bin/hf": "#!/usr/bin/env node\n" }),
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
				fs: memoryFs({
					[`${npmDir}\\harnessforce.exe`]: "",
					[`${npmDir}\\harnessforce.cmd`]: "",
				}),
				exec,
			});
			expect(await read("C:\\work")).toEqual({ kind: "found", key: "k" });
			expect(calls).toEqual([
				{
					file: `${npmDir}\\harnessforce.EXE`,
					args: ["otel-headers"],
					verbatim: false,
				},
			]);
		});

		it("starts npm's harnessforce.cmd with the hook's node instead of cmd.exe or node on PATH", async () => {
			const { exec, calls } = fakeExec({ ok: true, stdout: header("k") });
			const read = reader({
				platform: "win32",
				env: { ...env, PATH: `C:\\repo;C:\\nodejs;${npmDir}` },
				fs: memoryFs(
					{
						[`${npmDir}\\harnessforce.cmd`]: shim,
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

		it("starts another harnessforce.cmd through cmd.exe with the path quoted twice", async () => {
			const { exec, calls } = fakeExec({ ok: true, stdout: header("k") });
			const read = reader({
				platform: "win32",
				env,
				fs: memoryFs({
					[`${npmDir}\\harnessforce.cmd`]: "@echo off\r\nnode x.js %*\r\n",
				}),
				exec,
			});
			expect(await read("C:\\work")).toEqual({ kind: "found", key: "k" });
			expect(calls).toEqual([
				{
					file: "C:\\Windows\\system32\\cmd.exe",
					args: [
						"/d",
						"/s",
						"/c",
						`""${npmDir}\\harnessforce.CMD" otel-headers"`,
					],
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
					fs: memoryFs({ "C:\\tools\\harnessforce.bat": "" }),
					exec,
				});
				await read("C:\\work");
				expect(calls[0]?.file).toBe("C:\\Windows\\System32\\cmd.exe");
				expect(calls[0]?.args.at(-1)).toBe(
					'""C:\\tools\\harnessforce.BAT" otel-headers"',
				);
			}
		});

		it.each(["%", "!"])(
			"does not start a .cmd whose path contains %s",
			async (mark) => {
				const { exec, calls } = fakeExec({ ok: true, stdout: header("k") });
				const dir = `C:\\a${mark}b\\npm`;
				const read = reader({
					platform: "win32",
					env: { PATH: dir, PATHEXT: ".CMD", SystemRoot: "C:\\Windows" },
					fs: memoryFs({ [`${dir}\\harnessforce.cmd`]: "" }),
					exec,
				});
				expect(await read("C:\\work")).toEqual({ kind: "missing" });
				expect(calls).toEqual([]);
			},
		);
	});
});

describe("reading the harnessforce otel-headers output", () => {
	const readWith = (result: ExecResult) =>
		reader({
			platform: "linux",
			env: { PATH: "/bin" },
			fs: memoryFs({ "/bin/harnessforce": "" }),
			exec: fakeExec(result).exec,
		})("/work/web");

	// correlation.md「CLI」の`harnessforce otel-headers`の終了コード。hookは表示する文言をこれで選ぶ。
	it("reports exit code 3 as a missing key", async () =>
		expect(await readWith({ ok: false, stdout: "", exitCode: 3 })).toEqual({
			kind: "absent",
		}));

	it("reports exit code 4 as a withheld key", async () =>
		expect(await readWith({ ok: false, stdout: "", exitCode: 4 })).toEqual({
			kind: "withheld",
		}));

	// client-updates.md「送信の停止」: CLIの版が対応外のとき、keyを出さずに終了コード5で終える。
	it("reports exit code 5 as an unsupported CLI version", async () =>
		expect(await readWith({ ok: false, stdout: "", exitCode: 5 })).toEqual({
			kind: "cliUnsupported",
		}));

	it.each([
		["another non-zero exit", { ok: false, stdout: "", exitCode: 1 }],
		["a timeout", { ok: false, stdout: header("k") }],
		["output that is not JSON", { ok: true, stdout: "Bearer k" }],
		["a JSON array", { ok: true, stdout: "[]" }],
		["another header", { ok: true, stdout: '{"X-Key":"Bearer k"}' }],
		["a non-Bearer value", { ok: true, stdout: '{"Authorization":"Basic k"}' }],
		["an empty key", { ok: true, stdout: '{"Authorization":"Bearer "}' }],
	])("reports %s as an unreadable key", async (_, result) =>
		expect(await readWith(result)).toEqual({ kind: "unreadable" }),
	);

	// hookの1秒の上限を、kernelのkeyringからSecret Serviceへ移す処理で使わせない。
	it("starts harnessforce with HARNESSFORCE_NO_MIGRATE", async () => {
		const { exec, envs } = fakeExec({ ok: true, stdout: header("k") });
		await reader({
			platform: "linux",
			env: { PATH: "/bin", HARNESSFORCE_WORKSPACE_ID: "ws1" },
			fs: memoryFs({ "/bin/harnessforce": "" }),
			exec,
		})("/work/web");
		expect(envs).toEqual([
			{
				PATH: "/bin",
				HARNESSFORCE_WORKSPACE_ID: "ws1",
				HARNESSFORCE_NO_MIGRATE: "1",
			},
		]);
	});
});

describe.skipIf(process.platform === "win32")(
	"starting a real harnessforce",
	() => {
		function writeHf(body: string): string {
			const dir = tempDir("hf-bin-");
			const hf = join(dir, "harnessforce");
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

		it.each([
			["3", "absent"],
			["4", "withheld"],
			["1", "unreadable"],
		])("reads exit code %s as %s", async (code, kind) =>
			expect(await realReader(writeHf(`exit ${code}`))()).toEqual({ kind }),
		);

		it("gives up after 1 second", async () => {
			const dir = writeHf("sleep 5");
			const began = Date.now();
			expect(await realReader(dir)()).toEqual({ kind: "unreadable" });
			expect(Date.now() - began).toBeLessThan(3000);
		});

		// Windowsのcmd.exe経由と同じく、止めたprocessの子がstdoutを持ったまま残っても待たない。
		it("does not wait for a child that keeps stdout open after the limit", async () => {
			const dir = writeHf("sleep 5 &\nsleep 5");
			const began = Date.now();
			expect(await realReader(dir)()).toEqual({ kind: "unreadable" });
			expect(Date.now() - began).toBeLessThan(3000);
		});

		it("ignores a non-executable harnessforce", async () => {
			const dir = tempDir("hf-bin-");
			writeFileSync(join(dir, "harnessforce"), "#!/bin/sh\n");
			expect(await realReader(dir)()).toEqual({ kind: "missing" });
		});
	},
);
