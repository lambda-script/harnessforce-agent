import { EventEmitter } from "node:events";
import type { LookupFileSystem } from "@harnessforce/agent-core/process/lookup";
import { describe, expect, it } from "vitest";
import { openBrowser, type SpawnBrowser } from "../../src/init/browser.js";

const URL_WITH_QUERY = "https://app.example.test/oauth/authorize?a=1&b=2";

function fakeSpawn(outcome: { exitCode?: number; error?: Error; hang?: true }) {
	const calls: {
		command: string;
		args: readonly string[];
		env: Record<string, string>;
	}[] = [];
	const spawn: SpawnBrowser = (command, args, env) => {
		calls.push({ command, args, env });
		const child = Object.assign(new EventEmitter(), { unref: () => {} });
		setImmediate(() => {
			if (outcome.error) child.emit("error", outcome.error);
			else if (!outcome.hang) child.emit("exit", outcome.exitCode ?? 0);
		});
		return child;
	};
	return { spawn, calls };
}

const fsWith = (
	files: string[],
	gitMarkers: string[] = [],
): LookupFileSystem => ({
	isFile: async (path) =>
		files.map((f) => f.toLowerCase()).includes(path.toLowerCase()),
	isExecutable: async () => true,
	exists: async (path) => gitMarkers.includes(path),
	readSmallText: async () => undefined,
	readHead: async () => undefined,
});

const OPENERS = {
	darwin: { PATH: "/usr/bin", file: "/usr/bin/open" },
	linux: { PATH: "/usr/bin", file: "/usr/bin/xdg-open" },
	win32: {
		PATH: "C:\\Windows\\System32",
		file: "C:\\Windows\\System32\\rundll32.exe",
	},
} as const;

const optionsFor = (
	platform: keyof typeof OPENERS,
	spawn: SpawnBrowser,
	extra: Partial<Parameters<typeof openBrowser>[1]> = {},
) => ({
	platform,
	env: { PATH: OPENERS[platform].PATH, PATHEXT: ".EXE" },
	cwd: platform === "win32" ? "C:\\repo" : "/repo",
	restoredEnv: {},
	spawn,
	fs: fsWith([OPENERS[platform].file]),
	...extra,
});

describe("openBrowser", () => {
	it.each([
		["darwin", "/usr/bin/open", [URL_WITH_QUERY]],
		[
			"win32",
			"C:\\Windows\\System32\\rundll32.EXE",
			["url.dll,FileProtocolHandler", URL_WITH_QUERY],
		],
		["linux", "/usr/bin/xdg-open", [URL_WITH_QUERY]],
	] as const)("starts the %s opener by its absolute path without a shell", async (platform, command, args) => {
		const { spawn, calls } = fakeSpawn({});
		expect(await openBrowser(URL_WITH_QUERY, optionsFor(platform, spawn))).toBe(
			true,
		);
		expect(calls.map(({ command, args }) => ({ command, args }))).toEqual([
			{ command, args },
		]);
	});

	it("does not start an opener placed in the repository", async () => {
		const { spawn, calls } = fakeSpawn({});
		const opened = await openBrowser(
			URL_WITH_QUERY,
			optionsFor("win32", spawn, {
				env: { PATH: "C:\\repo;C:\\repo\\bin", PATHEXT: ".EXE" },
				fs: fsWith(
					["C:\\repo\\rundll32.exe", "C:\\repo\\bin\\rundll32.exe"],
					["C:\\repo\\.git"],
				),
			}),
		);
		expect(opened).toBe(false);
		expect(calls).toEqual([]);
	});

	// correlation.md「Node.jsの実行時の変数」: ブラウザには取り除く前の値を戻す。
	it("gives the opener the runtime variables removed before the relaunch", async () => {
		const { spawn, calls } = fakeSpawn({});
		await openBrowser(
			URL_WITH_QUERY,
			optionsFor("linux", spawn, {
				env: { PATH: "/usr/bin", DISPLAY: ":0" },
				restoredEnv: { HTTPS_PROXY: "http://corp:8080" },
			}),
		);
		expect(calls[0]?.env).toEqual({
			PATH: "/usr/bin",
			DISPLAY: ":0",
			HTTPS_PROXY: "http://corp:8080",
		});
	});

	it.each([
		["the opener is missing", { error: new Error("ENOENT") }],
		["the opener fails", { exitCode: 3 }],
	])("reports failure when %s", async (_, outcome) =>
		expect(
			await openBrowser(
				URL_WITH_QUERY,
				optionsFor("linux", fakeSpawn(outcome).spawn),
			),
		).toBe(false));

	it("treats an opener that keeps running as started", async () =>
		expect(
			await openBrowser(
				URL_WITH_QUERY,
				optionsFor("linux", fakeSpawn({ hang: true }).spawn, {
					stillRunningMs: 20,
				}),
			),
		).toBe(true));
});
