import { chmodSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	commandLineFor,
	findCommand,
	type LookupFileSystem,
} from "../../src/process/lookup.js";

// correlation.md「commandの解決」。fileの有無と内容はmemory上で与える。
function memoryFs(
	files: Record<string, string>,
	options: { gitMarkers?: string[]; notExecutable?: string[] } = {},
): LookupFileSystem {
	// Windowsのfile systemと同じく、大文字と小文字を区別せずに比べる。
	const lower = (path: string) => path.toLowerCase();
	const contents = new Map(
		Object.entries(files).map(([path, text]) => [lower(path), text]),
	);
	const markers = (options.gitMarkers ?? []).map(lower);
	return {
		isFile: async (path) => contents.has(lower(path)),
		isExecutable: async (path) => !options.notExecutable?.includes(path),
		exists: async (path) => markers.includes(lower(path)),
		readSmallText: async (path, maxBytes) => {
			const text = contents.get(lower(path));
			return text !== undefined && Buffer.byteLength(text) <= maxBytes
				? text
				: undefined;
		},
		readHead: async (path, maxBytes) => {
			const text = contents.get(lower(path));
			return text === undefined
				? undefined
				: Buffer.from(text).subarray(0, maxBytes).toString("utf8");
		},
	};
}

const WIN_ENV = {
	PATH: "C:\\repo;C:\\repo\\tools;C:\\Program Files\\Git\\cmd;C:\\Users\\John Doe\\AppData\\Roaming\\npm",
	PATHEXT: ".COM;.EXE;.BAT;.CMD",
	SystemRoot: "C:\\Windows",
};

const npmShim = (script: string, current = true) =>
	[
		"@ECHO off",
		"GOTO start",
		":find_dp0",
		"SET dp0=%~dp0",
		"EXIT /b",
		":start",
		"SETLOCAL",
		"CALL :find_dp0",
		"",
		'IF EXIST "%dp0%\\node.exe" (',
		'  SET "_prog=%dp0%\\node.exe"',
		") ELSE (",
		'  SET "_prog=node"',
		...(current ? [] : ["  SET PATHEXT=%PATHEXT:;.JS;=;%"]),
		")",
		"",
		current
			? `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & set PATHEXT=%PATHEXT:;.JS;=;% & "%_prog%"  "%dp0%\\${script}" %*`
			: `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${script}" %*`,
		"",
	].join("\r\n");

describe("finding a command on PATH", () => {
	it("skips the current directory and the repository around it on Windows", async () => {
		const fs = memoryFs(
			{
				"C:\\repo\\git.exe": "",
				"C:\\repo\\tools\\git.exe": "",
				"C:\\Program Files\\Git\\cmd\\git.exe": "",
			},
			{ gitMarkers: ["C:\\repo\\.git"] },
		);
		expect(
			await findCommand("git", {
				platform: "win32",
				env: WIN_ENV,
				bases: ["C:\\repo\\packages\\web"],
				fs,
			}),
		).toBe("C:\\Program Files\\Git\\cmd\\git.EXE");
	});

	it("compares directories without case and after resolving dots on Windows", async () => {
		const fs = memoryFs(
			{ "C:\\Repo\\x\\..\\git.exe": "", "C:\\Repo\\git.exe": "" },
			{ gitMarkers: [] },
		);
		expect(
			await findCommand("git", {
				platform: "win32",
				env: { ...WIN_ENV, PATH: "C:\\Repo\\x\\..;C:\\REPO" },
				bases: ["c:\\repo"],
				fs,
			}),
		).toBeUndefined();
	});

	it("keeps directories below a current directory that is not in a repository", async () => {
		const fs = memoryFs({ "/home/john/.local/bin/claude": "" });
		expect(
			await findCommand("claude", {
				platform: "linux",
				env: { PATH: "/home/john:/home/john/.local/bin" },
				bases: ["/home/john"],
				fs,
			}),
		).toBe("/home/john/.local/bin/claude");
	});

	it("excludes the current directory itself outside a repository", async () => {
		const fs = memoryFs({ "/home/john/claude": "" });
		expect(
			await findCommand("claude", {
				platform: "linux",
				env: { PATH: "/home/john" },
				bases: ["/home/john"],
				fs,
			}),
		).toBeUndefined();
	});

	it("excludes every base, such as the hook's process directory and its input cwd", async () => {
		const fs = memoryFs(
			{ "/proc-cwd/hf": "", "/work/web/bin/hf": "", "/usr/local/bin/hf": "" },
			{ gitMarkers: ["/work/web/.git"] },
		);
		expect(
			await findCommand("hf", {
				platform: "darwin",
				env: { PATH: "/proc-cwd:/work/web/bin:/usr/local/bin" },
				bases: ["/proc-cwd", "/work/web"],
				fs,
			}),
		).toBe("/usr/local/bin/hf");
	});

	it("skips empty and relative PATH entries and files without the execute permission", async () => {
		const fs = memoryFs(
			{ "bin/hf": "", "/opt/a/hf": "", "/opt/b/hf": "" },
			{ notExecutable: ["/opt/a/hf"] },
		);
		expect(
			await findCommand("hf", {
				platform: "linux",
				env: { PATH: "::bin:/opt/a:/opt/b" },
				bases: ["/work"],
				fs,
			}),
		).toBe("/opt/b/hf");
	});

	it("does not append PATHEXT to a name that already has one of its extensions", async () => {
		const fs = memoryFs({
			"C:\\npm\\claude.cmd": "",
			"C:\\npm\\claude.cmd.CMD": "",
		});
		const context = {
			platform: "win32" as const,
			env: { ...WIN_ENV, PATH: "C:\\npm" },
			bases: ["C:\\work"],
			fs,
		};
		expect(await findCommand("claude.cmd", context)).toBe(
			"C:\\npm\\claude.cmd",
		);
		expect(await findCommand("CLAUDE.CMD", context)).toBe(
			"C:\\npm\\CLAUDE.CMD",
		);
	});

	it("appends each PATHEXT extension in order to a name without one", async () => {
		const fs = memoryFs({
			"C:\\npm\\claude.cmd": "",
			"C:\\npm\\claude.exe": "",
		});
		expect(
			await findCommand("claude", {
				platform: "win32",
				env: { PATH: "C:\\npm", PATHEXT: ".EXE;.CMD" },
				bases: ["C:\\work"],
				fs,
			}),
		).toBe("C:\\npm\\claude.EXE");
	});

	it("reads Path and Pathext case-insensitively on Windows", async () => {
		const fs = memoryFs({ "C:\\npm\\hf.cmd": "" });
		expect(
			await findCommand("hf", {
				platform: "win32",
				env: { Path: "C:\\npm", Pathext: ".CMD" },
				bases: ["C:\\work"],
				fs,
			}),
		).toBe("C:\\npm\\hf.CMD");
	});
});

describe("building the command line on Windows", () => {
	const shimDir = "C:\\Users\\John Doe\\AppData\\Roaming\\npm";
	const runningNode = "C:\\Program Files\\nodejs\\node.exe";
	const context = (
		files: Record<string, string>,
		env: Record<string, string> = WIN_ENV,
	) => ({
		platform: "win32" as const,
		env,
		bases: ["C:\\repo"],
		execPath: runningNode,
		fs: memoryFs(files, { gitMarkers: ["C:\\repo\\.git"] }),
	});

	it("starts an npm shim with the running node instead of the node.exe next to it", async () => {
		const shim = `${shimDir}\\claude.cmd`;
		const line = await commandLineFor(
			shim,
			["--settings", "C:\\Temp\\a b\\settings.json", "100%!"],
			context({
				[shim]: npmShim("node_modules\\@anthropic-ai\\claude-code\\cli.js"),
				[`${shimDir}\\node.exe`]: "",
			}),
		);
		expect(line).toEqual({
			file: runningNode,
			args: [
				`${shimDir}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`,
				"--settings",
				"C:\\Temp\\a b\\settings.json",
				"100%!",
			],
			verbatim: false,
		});
	});

	it("starts an npm shim with the running node instead of a node on PATH", async () => {
		const shim = `${shimDir}\\hf.cmd`;
		const line = await commandLineFor(
			shim,
			["otel-headers"],
			context(
				{
					[shim]: npmShim(
						"node_modules\\@harnessforce\\cli\\dist\\bin.js",
						false,
					),
					"C:\\repo\\node.exe": "",
					"C:\\tools\\node.exe": "",
				},
				{
					...WIN_ENV,
					PATH: `C:\\repo;C:\\tools;${shimDir}`,
				},
			),
		);
		expect(line).toEqual({
			file: runningNode,
			args: [
				`${shimDir}\\node_modules\\@harnessforce\\cli\\dist\\bin.js`,
				"otel-headers",
			],
			verbatim: false,
		});
	});

	it("starts an npm shim when no node is on PATH", async () => {
		const shim = `${shimDir}\\hf.cmd`;
		expect(
			await commandLineFor(
				shim,
				["otel-headers"],
				context(
					{ [shim]: npmShim("x\\bin.js"), "C:\\tools\\node.cmd": "" },
					{ ...WIN_ENV, PATH: `C:\\tools;${shimDir}` },
				),
			),
		).toEqual({
			file: runningNode,
			args: [`${shimDir}\\x\\bin.js`, "otel-headers"],
			verbatim: false,
		});
	});

	it.each([
		["a shim whose script has %", npmShim("x%PATH%\\bin.js")],
		[
			"a shim with node flags",
			npmShim("x\\bin.js").replace('"%_prog%"  ', '"%_prog%" --expose_gc '),
		],
		["a batch file that is not a shim", "@echo off\r\nnode x.js %*\r\n"],
	])("runs %s through cmd.exe", async (_name, content) => {
		const file = `${shimDir}\\tool.cmd`;
		expect(
			await commandLineFor(
				file,
				["otel-headers"],
				context(
					{ [file]: content },
					{ ...WIN_ENV, ComSpec: "C:\\Windows\\System32\\cmd.exe" },
				),
				{ quoteArgs: false },
			),
		).toEqual({
			file: "C:\\Windows\\System32\\cmd.exe",
			args: ["/d", "/s", "/c", `""${file}" otel-headers"`],
			verbatim: true,
		});
	});

	it("does not treat a shim larger than 64 KiB as an npm shim", async () => {
		const file = `${shimDir}\\big.cmd`;
		const content = `${npmShim("x\\bin.js")}REM ${"x".repeat(64 * 1024)}\r\n`;
		const line = await commandLineFor(
			file,
			[],
			context({ [file]: content, [`${shimDir}\\node.exe`]: "" }),
		);
		expect(line?.file).toBe("C:\\Windows\\System32\\cmd.exe");
	});

	it("quotes every argument for hf run's cmd.exe command line", async () => {
		const file = "C:\\tools\\agent.bat";
		expect(
			await commandLineFor(
				file,
				["--settings", "C:\\t\\s.json"],
				context({ [file]: "" }),
			),
		).toEqual({
			file: "C:\\Windows\\System32\\cmd.exe",
			args: ["/d", "/s", "/c", `""${file}" "--settings" "C:\\t\\s.json""`],
			verbatim: true,
		});
	});

	it.each([
		["a relative ComSpec", { ComSpec: "cmd.exe" }],
		["a missing ComSpec", {}],
		["a ComSpec in the current directory", { ComSpec: "C:\\repo\\cmd.exe" }],
		["a ComSpec inside the repository", { ComSpec: "C:\\repo\\bin\\cmd.exe" }],
	])("uses SystemRoot's cmd.exe for %s", async (_name, comSpec) => {
		const file = "C:\\tools\\agent.cmd";
		const line = await commandLineFor(
			file,
			[],
			context(
				{ [file]: "" },
				{ PATH: "", SystemRoot: "C:\\Windows", ...comSpec },
			),
		);
		expect(line?.file).toBe("C:\\Windows\\System32\\cmd.exe");
	});

	it("keeps an absolute ComSpec outside the excluded directories", async () => {
		const file = "C:\\tools\\agent.cmd";
		const line = await commandLineFor(
			file,
			[],
			context({ [file]: "" }, { ...WIN_ENV, ComSpec: "D:\\shells\\cmd.exe" }),
		);
		expect(line?.file).toBe("D:\\shells\\cmd.exe");
	});

	it.each([
		["a missing SystemRoot", {}],
		["a relative SystemRoot", { SystemRoot: "Windows" }],
		["a SystemRoot inside the repository", { SystemRoot: "C:\\repo\\win" }],
		["a SystemRoot equal to the current directory", { SystemRoot: "C:\\repo" }],
	])("cannot start cmd.exe with %s and no usable ComSpec", async (_name, root) => {
		const file = "C:\\tools\\agent.cmd";
		expect(
			await commandLineFor(
				file,
				[],
				context({ [file]: "" }, { PATH: "", ...root }),
			),
		).toBeUndefined();
	});

	it.each([
		['"', 'a"b'],
		["%", "100%"],
		["!", "hi!"],
		["CR", "a\rb"],
		["LF", "a\nb"],
	])("refuses %s in a cmd.exe argument", async (_name, arg) => {
		const file = "C:\\tools\\agent.cmd";
		expect(
			await commandLineFor(file, [arg], context({ [file]: "" })),
		).toBeUndefined();
	});

	it("refuses ! and % in the path of a batch file", async () => {
		for (const file of ["C:\\a!b\\hf.cmd", "C:\\a%b\\hf.cmd"])
			expect(
				await commandLineFor(file, ["otel-headers"], context({ [file]: "" }), {
					quoteArgs: false,
				}),
			).toBeUndefined();
	});

	it("starts other files directly", async () => {
		expect(
			await commandLineFor("C:\\Git\\git.exe", ["status"], context({})),
		).toEqual({ file: "C:\\Git\\git.exe", args: ["status"], verbatim: false });
	});
});

describe("building the command line elsewhere", () => {
	const runningNode = "/opt/node/bin/node";
	const posix = (files: Record<string, string>) => ({
		platform: "linux" as const,
		env: { PATH: ":/usr/local/bin:/usr/bin" },
		bases: ["/work"],
		execPath: runningNode,
		fs: memoryFs(files),
	});

	it.each([
		["npm's env shebang", "#!/usr/bin/env node\nrequire('./cli');\n"],
		["a CRLF line", "#!/usr/bin/env node\r\nrequire('./cli');\r\n"],
		["another env path and tabs", "#!\t/bin/env\tnode \n"],
	])("starts a Node.js script with %s on the running node", async (_name, text) => {
		const file = "/usr/local/bin/claude";
		expect(
			await commandLineFor(
				file,
				["--settings", "/t/s.json"],
				posix({ [file]: text }),
			),
		).toEqual({
			file: runningNode,
			args: [file, "--settings", "/t/s.json"],
			verbatim: false,
		});
	});

	it.each([
		["a shell script", "#!/bin/sh\nexec node x.js\n"],
		["an absolute node", "#!/usr/local/bin/node\n"],
		["env with node flags", "#!/usr/bin/env -S node --no-warnings\n"],
		["env with another program", "#!/usr/bin/env nodejs\n"],
		["a relative env", "#!env node\n"],
		["no shebang", "require('./cli');\n"],
		[
			"a first line longer than 256 bytes",
			`#!/usr/bin/env node ${" ".repeat(256)}\n`,
		],
		["no line feed", "#!/usr/bin/env node"],
	])("starts %s as resolved", async (_name, text) => {
		const file = "/usr/local/bin/tool";
		expect(await commandLineFor(file, ["a"], posix({ [file]: text }))).toEqual({
			file,
			args: ["a"],
			verbatim: false,
		});
	});

	it.skipIf(process.platform === "win32")(
		"reads the shebang through npm's bin link and passes the link as the script",
		async () => {
			const dir = await mkdtemp(join(tmpdir(), "hf-lookup-"));
			const script = join(dir, "bin.js");
			writeFileSync(script, "#!/usr/bin/env node\n");
			chmodSync(script, 0o755);
			const link = join(dir, "hf");
			symlinkSync(script, link);
			expect(
				await commandLineFor(link, ["otel-headers"], {
					platform: process.platform,
					env: {},
					bases: ["/work"],
				}),
			).toEqual({
				file: process.execPath,
				args: [link, "otel-headers"],
				verbatim: false,
			});
		},
	);

	it("starts a .cmd name directly outside Windows", async () => {
		expect(
			await commandLineFor("/opt/x.cmd", ["a"], {
				platform: "linux",
				env: {},
				bases: ["/work"],
				fs: memoryFs({}),
			}),
		).toEqual({ file: "/opt/x.cmd", args: ["a"], verbatim: false });
	});
});
