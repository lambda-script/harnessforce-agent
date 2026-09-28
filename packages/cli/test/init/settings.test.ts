import {
	chmodSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	mergeUserSettings,
	readUserSettings,
	userSettingsPath,
	writeUserSettings,
} from "../../src/init/settings.js";
import { tempDir } from "../config/support.js";

describe("user settings", () => {
	it("lives in ~/.claude unless CLAUDE_CONFIG_DIR is an absolute path", () => {
		expect(userSettingsPath({}, "/home/u")).toBe(
			join("/home/u", ".claude", "settings.json"),
		);
		expect(userSettingsPath({ CLAUDE_CONFIG_DIR: "/cfg" }, "/home/u")).toBe(
			join("/cfg", "settings.json"),
		);
		expect(userSettingsPath({ CLAUDE_CONFIG_DIR: "cfg" }, "/home/u")).toBe(
			join("/home/u", ".claude", "settings.json"),
		);
	});

	it("reads a missing file as empty settings", async () =>
		expect(await readUserSettings(join(tempDir(), "settings.json"))).toEqual({
			kind: "ok",
			settings: {},
		}));

	it.each([
		["not JSON", "{"],
		["a JSON array", "[]"],
		["env that is not an object", '{"env":"x"}'],
		["enabledPlugins that is not an object", '{"enabledPlugins":[]}'],
	])("rejects %s", async (_, content) => {
		const path = join(tempDir(), "settings.json");
		writeFileSync(path, content);
		expect(await readUserSettings(path)).toEqual({ kind: "invalid" });
	});

	it("rejects a path that cannot be read as a file", async () => {
		const path = join(tempDir(), "settings.json");
		mkdirSync(path);
		expect(await readUserSettings(path)).toEqual({ kind: "invalid" });
	});

	it("overwrites only its own keys and keeps the rest", () =>
		expect(
			mergeUserSettings(
				{
					model: "opus",
					otelHeadersHelper: "old-helper",
					env: { EDITOR: "vim", HARNESSFORCE_WORKSPACE_ID: "old" },
					enabledPlugins: { "other@market": false },
				},
				{ HARNESSFORCE_WORKSPACE_ID: "ws1" },
			),
		).toEqual({
			model: "opus",
			otelHeadersHelper: "hf otel-headers",
			env: { EDITOR: "vim", HARNESSFORCE_WORKSPACE_ID: "ws1" },
			enabledPlugins: {
				"other@market": false,
				"harnessforce@harnessforce-agent": true,
			},
		}));

	it("writes through a temporary file and creates the directory", async () => {
		const dir = join(tempDir(), "nested");
		const path = join(dir, "settings.json");
		await writeUserSettings(path, { env: { A: "1" } });
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ env: { A: "1" } });
	});

	it.skipIf(process.platform === "win32")(
		"keeps the mode of an existing file and creates new files as 0600",
		async () => {
			const existing = join(tempDir(), "settings.json");
			writeFileSync(existing, "{}");
			chmodSync(existing, 0o640);
			await writeUserSettings(existing, { env: {} });
			expect(statSync(existing).mode & 0o777).toBe(0o640);
			const created = join(tempDir(), "settings.json");
			await writeUserSettings(created, {});
			expect(statSync(created).mode & 0o777).toBe(0o600);
		},
	);
});
