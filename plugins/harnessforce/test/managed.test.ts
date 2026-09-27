import { expect, it } from "vitest";
import { managedDirFor } from "../src/managed.js";

it.each([
	["darwin", "/Library/Application Support/ClaudeCode"],
	["linux", "/etc/claude-code"],
	["win32", "C:\\Program Files\\ClaudeCode"],
] as const)("uses the documented managed directory on %s", (platform, dir) =>
	expect(managedDirFor(platform)).toBe(dir));
