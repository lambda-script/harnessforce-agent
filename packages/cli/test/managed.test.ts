import { managedDir } from "@harnessforce/test-support/managed-dir";
import { expect, it } from "vitest";
import { managedDirFor, readManagedEnv } from "../src/managed.js";

it.each([
	["darwin", "/Library/Application Support/ClaudeCode"],
	["linux", "/etc/claude-code"],
	["win32", "C:\\Program Files\\ClaudeCode"],
] as const)("uses the documented managed directory on %s", (platform, dir) =>
	expect(managedDirFor(platform)).toBe(dir));

it("reads each variable from the last managed file that sets it", async () => {
	const dir = managedDir(
		{ env: { A: "base", B: "base" } },
		{
			"20-b.json": JSON.stringify({ env: { B: "twenty" } }),
			"10-a.json": JSON.stringify({ env: { A: "ten", B: "ten" } }),
			"30-broken.json": "{",
			"40-env-array.json": JSON.stringify({ env: ["A"] }),
			"50-number.json": JSON.stringify({ env: { A: 5 } }),
		},
	);
	expect(await readManagedEnv(dir, ["A", "B", "C"])).toEqual({
		A: "ten",
		B: "twenty",
		C: undefined,
	});
});

it("reads nothing from a missing directory", async () =>
	expect(await readManagedEnv("/nonexistent/hf-managed", ["A"])).toEqual({
		A: undefined,
	}));
