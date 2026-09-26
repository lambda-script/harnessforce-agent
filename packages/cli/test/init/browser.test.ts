import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { openBrowser, type SpawnBrowser } from "../../src/init/browser.js";

const URL_WITH_QUERY = "https://app.example.test/oauth/authorize?a=1&b=2";

function fakeSpawn(outcome: { exitCode?: number; error?: Error; hang?: true }) {
	const calls: { command: string; args: readonly string[] }[] = [];
	const spawn: SpawnBrowser = (command, args) => {
		calls.push({ command, args });
		const child = Object.assign(new EventEmitter(), { unref: () => {} });
		setImmediate(() => {
			if (outcome.error) child.emit("error", outcome.error);
			else if (!outcome.hang) child.emit("exit", outcome.exitCode ?? 0);
		});
		return child;
	};
	return { spawn, calls };
}

describe("openBrowser", () => {
	it.each([
		["darwin", "open", [URL_WITH_QUERY]],
		["win32", "rundll32", ["url.dll,FileProtocolHandler", URL_WITH_QUERY]],
		["linux", "xdg-open", [URL_WITH_QUERY]],
	] as const)("uses the %s opener without a shell", async (platform, command, args) => {
		const { spawn, calls } = fakeSpawn({});
		expect(await openBrowser(URL_WITH_QUERY, platform, spawn)).toBe(true);
		expect(calls).toEqual([{ command, args }]);
	});

	it.each([
		["the opener is missing", { error: new Error("ENOENT") }],
		["the opener fails", { exitCode: 3 }],
	])("reports failure when %s", async (_, outcome) =>
		expect(
			await openBrowser(URL_WITH_QUERY, "linux", fakeSpawn(outcome).spawn),
		).toBe(false));

	it("treats an opener that keeps running as started", async () =>
		expect(
			await openBrowser(
				URL_WITH_QUERY,
				"linux",
				fakeSpawn({ hang: true }).spawn,
				20,
			),
		).toBe(true));
});
