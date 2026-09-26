import { describe, expect, it } from "vitest";
import { commandLine, resolveAgentFile } from "../../src/run/command.js";

const runnable = (files: readonly string[]) => {
	const checked: string[] = [];
	return {
		checked,
		isRunnable: async (path: string) => {
			checked.push(path);
			return files.includes(path);
		},
	};
};

describe("resolveAgentFile", () => {
	it("searches the absolute PATH directories in order", async () => {
		const files = runnable(["/b/claude", "/c/claude"]);
		expect(
			await resolveAgentFile("claude", {
				platform: "linux",
				env: { PATH: "/a:relative:/b:/c" },
				cwd: "/work",
				isRunnable: files.isRunnable,
			}),
		).toBe("/b/claude");
		expect(files.checked).toEqual(["/a/claude", "/b/claude"]);
	});

	it("adds the PATHEXT extensions in order on Windows", async () => {
		const files = runnable(["C:\\npm\\claude.CMD"]);
		expect(
			await resolveAgentFile("claude", {
				platform: "win32",
				env: { PATH: "C:\\bin;C:\\npm", PATHEXT: ".EXE;.CMD" },
				cwd: "C:\\work",
				isRunnable: files.isRunnable,
			}),
		).toBe("C:\\npm\\claude.CMD");
		expect(files.checked).toEqual([
			"C:\\bin\\claude.EXE",
			"C:\\bin\\claude.CMD",
			"C:\\npm\\claude.EXE",
			"C:\\npm\\claude.CMD",
		]);
	});

	it("uses the default PATHEXT on Windows without one", async () => {
		const files = runnable(["C:\\npm\\claude.BAT"]);
		expect(
			await resolveAgentFile("claude", {
				platform: "win32",
				env: { PATH: "C:\\npm" },
				cwd: "C:\\work",
				isRunnable: files.isRunnable,
			}),
		).toBe("C:\\npm\\claude.BAT");
	});

	it.each([
		["linux", "./bin/claude", "/work", "/work/bin/claude"],
		["linux", "/opt/claude", "/work", "/opt/claude"],
		["win32", "bin\\claude.cmd", "C:\\work", "C:\\work\\bin\\claude.cmd"],
		["win32", "C:/tools/claude.exe", "C:\\work", "C:\\tools\\claude.exe"],
	] as const)("uses a command with a path separator as is on %s (%s)", async (platform, agent, cwd, expected) => {
		const files = runnable([expected]);
		expect(
			await resolveAgentFile(agent, {
				platform,
				env: { PATH: platform === "win32" ? "C:\\bin" : "/bin" },
				cwd,
				isRunnable: files.isRunnable,
			}),
		).toBe(expected);
		expect(files.checked).toEqual([expected]);
	});

	it.each([
		["not on PATH", "claude"],
		["a missing path", "./claude"],
	])("returns nothing for %s", async (_, agent) =>
		expect(
			await resolveAgentFile(agent, {
				platform: "linux",
				env: { PATH: "/bin" },
				cwd: "/work",
				isRunnable: runnable([]).isRunnable,
			}),
		).toBeUndefined());
});

describe("commandLine", () => {
	it("runs other files directly on every platform", () => {
		expect(
			commandLine("/usr/bin/claude", ["--settings", "/tmp/s.json", "-p"], {
				platform: "linux",
				env: {},
			}),
		).toEqual({
			file: "/usr/bin/claude",
			args: ["--settings", "/tmp/s.json", "-p"],
			verbatim: false,
		});
		expect(
			commandLine("C:\\bin\\claude.exe", ["a b"], {
				platform: "win32",
				env: {},
			}),
		).toEqual({ file: "C:\\bin\\claude.exe", args: ["a b"], verbatim: false });
	});

	it.each([
		"C:\\npm\\claude.cmd",
		"C:\\npm\\claude.BAT",
	])("quotes every argument for cmd.exe with an outer pair for %s", (file) =>
		expect(
			commandLine(
				file,
				["--settings", "C:\\Temp\\hf run\\settings.json", "-p", "a & b | c"],
				{ platform: "win32", env: { ComSpec: "C:\\Windows\\cmd.exe" } },
			),
		).toEqual({
			file: "C:\\Windows\\cmd.exe",
			args: [
				"/d",
				"/s",
				"/c",
				`""${file}" "--settings" "C:\\Temp\\hf run\\settings.json" "-p" "a & b | c""`,
			],
			verbatim: true,
		}));

	it("keeps a path with spaces as one file", () =>
		expect(
			commandLine("C:\\Users\\John Doe\\npm\\claude.cmd", [], {
				platform: "win32",
				env: {},
			}),
		).toEqual({
			file: "cmd.exe",
			args: ["/d", "/s", "/c", `""C:\\Users\\John Doe\\npm\\claude.cmd""`],
			verbatim: true,
		}));

	it.each([
		['"'],
		["%"],
		["!"],
		["\n"],
		["\r"],
	])("refuses %j in a .cmd path or argument", (character) => {
		const options = { platform: "win32" as const, env: {} };
		expect(
			commandLine(`C:\\npm${character}\\claude.cmd`, [], options),
		).toBeUndefined();
		expect(
			commandLine("C:\\npm\\claude.cmd", ["-p", `a${character}b`], options),
		).toBeUndefined();
	});

	it("passes the same characters to other files", () =>
		expect(
			commandLine("/usr/bin/claude", ['"%!\n'], { platform: "linux", env: {} }),
		).toMatchObject({ args: ['"%!\n'] }));
});
