import { describe, expect, it } from "vitest";
import type { LookupFileSystem } from "../../src/process/lookup.js";
import { commandLine, resolveAgentFile } from "../../src/run/command.js";

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
	};
}

const NPM = "C:\\Users\\John Doe\\AppData\\Roaming\\npm";
const claudeShim = [
	'IF EXIST "%dp0%\\node.exe" (',
	'  SET "_prog=%dp0%\\node.exe"',
	") ELSE (",
	'  SET "_prog=node"',
	")",
	'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & set PATHEXT=%PATHEXT:;.JS;=;% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
].join("\r\n");

describe("resolveAgentFile", () => {
	it("searches the absolute PATH directories outside the working repository", async () => {
		expect(
			await resolveAgentFile("claude", {
				platform: "linux",
				env: { PATH: "/work/web/bin:relative:/b" },
				cwd: "/work/web",
				fs: memoryFs(
					{
						"/work/web/bin/claude": "",
						"relative/claude": "",
						"/b/claude": "",
					},
					["/work/web/.git"],
				),
			}),
		).toBe("/b/claude");
	});

	it("looks up claude.cmd as given on Windows", async () => {
		expect(
			await resolveAgentFile("claude.cmd", {
				platform: "win32",
				env: { PATH: NPM, PATHEXT: ".EXE;.CMD" },
				cwd: "C:\\work",
				fs: memoryFs({ [`${NPM}\\claude.cmd`]: "" }),
			}),
		).toBe(`${NPM}\\claude.cmd`);
	});

	it("uses a command with a path separator as given, relative to cwd", async () => {
		expect(
			await resolveAgentFile("./bin/claude", {
				platform: "linux",
				env: { PATH: "/usr/bin" },
				cwd: "/work/web",
				fs: memoryFs({ "/work/web/bin/claude": "" }, ["/work/web/.git"]),
			}),
		).toBe("/work/web/bin/claude");
	});

	it("does not append PATHEXT to an explicit path on Windows", async () => {
		expect(
			await resolveAgentFile("C:\\tools\\claude", {
				platform: "win32",
				env: { PATH: "", PATHEXT: ".EXE" },
				cwd: "C:\\work",
				fs: memoryFs({ "C:\\tools\\claude.exe": "" }),
			}),
		).toBeUndefined();
	});

	it("returns undefined when the agent is missing", async () => {
		expect(
			await resolveAgentFile("claude", {
				platform: "linux",
				env: { PATH: "/usr/bin" },
				cwd: "/work",
				fs: memoryFs({}),
			}),
		).toBeUndefined();
	});
});

describe("commandLine", () => {
	it("starts npm's claude.cmd with node and passes every argument unquoted", async () => {
		expect(
			await commandLine(
				`${NPM}\\claude.cmd`,
				["--settings", "C:\\T\\s.json", "-p", "50%!"],
				{
					platform: "win32",
					env: {
						PATH: "C:\\nodejs",
						PATHEXT: ".EXE",
						SystemRoot: "C:\\Windows",
					},
					cwd: "C:\\work",
					fs: memoryFs({
						[`${NPM}\\claude.cmd`]: claudeShim,
						"C:\\nodejs\\node.exe": "",
					}),
				},
			),
		).toEqual({
			file: "C:\\nodejs\\node.EXE",
			args: [
				`${NPM}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`,
				"--settings",
				"C:\\T\\s.json",
				"-p",
				"50%!",
			],
			verbatim: false,
		});
	});

	it("runs another .cmd through SystemRoot's cmd.exe with every argument quoted", async () => {
		expect(
			await commandLine(
				"C:\\tools\\agent.cmd",
				["--settings", "C:\\T\\s.json"],
				{
					platform: "win32",
					env: { ComSpec: "cmd.exe", SystemRoot: "C:\\Windows" },
					cwd: "C:\\work",
					fs: memoryFs({ "C:\\tools\\agent.cmd": "@echo off\r\n" }),
				},
			),
		).toEqual({
			file: "C:\\Windows\\System32\\cmd.exe",
			args: [
				"/d",
				"/s",
				"/c",
				'""C:\\tools\\agent.cmd" "--settings" "C:\\T\\s.json""',
			],
			verbatim: true,
		});
	});

	it("refuses a cmd.exe argument with %", async () => {
		expect(
			await commandLine("C:\\tools\\agent.cmd", ["100%"], {
				platform: "win32",
				env: { SystemRoot: "C:\\Windows" },
				cwd: "C:\\work",
				fs: memoryFs({ "C:\\tools\\agent.cmd": "" }),
			}),
		).toBeUndefined();
	});

	it("starts other files directly", async () => {
		expect(
			await commandLine("/usr/bin/claude", ["-p", "hi"], {
				platform: "linux",
				env: {},
				cwd: "/work",
			}),
		).toEqual({ file: "/usr/bin/claude", args: ["-p", "hi"], verbatim: false });
	});
});
