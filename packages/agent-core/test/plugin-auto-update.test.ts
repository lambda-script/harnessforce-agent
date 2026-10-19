import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPluginAutoUpdateEffective } from "../src/plugin-auto-update.js";

// client-updates.md「表示」: pluginのoutdatedを表示しない3つの条件。

async function layout(files: Record<string, unknown>) {
	const root = await mkdtemp(join(tmpdir(), "hf-auto-update-"));
	for (const [relative, value] of Object.entries(files)) {
		await mkdir(join(root, relative, ".."), { recursive: true });
		await writeFile(join(root, relative), JSON.stringify(value));
	}
	return {
		userSettingsPath: join(root, "user/settings.json"),
		managedDir: join(root, "managed"),
		projectDir: join(root, "project"),
	};
}

const entry = (autoUpdate: boolean) => ({
	"harnessforce-agent": {
		source: { source: "github", repo: "lambda-script/harnessforce-agent" },
		autoUpdate,
	},
});

describe("isPluginAutoUpdateEffective", () => {
	it("is effective when only the user settings turn it on", async () => {
		const paths = await layout({
			"user/settings.json": { extraKnownMarketplaces: entry(true) },
		});
		expect(await isPluginAutoUpdateEffective({ ...paths, env: {} })).toBe(true);
	});

	it("reads the alias key when the canonical key is absent", async () => {
		const paths = await layout({
			"user/settings.json": { additionalMarketplaces: entry(true) },
		});
		expect(await isPluginAutoUpdateEffective({ ...paths, env: {} })).toBe(true);
	});

	it("is not effective when the user settings turn it off or lack the entry", async () => {
		for (const settings of [
			{ extraKnownMarketplaces: entry(false) },
			{},
			{
				extraKnownMarketplaces: entry(false),
				additionalMarketplaces: entry(true),
			},
		]) {
			const paths = await layout({ "user/settings.json": settings });
			expect(await isPluginAutoUpdateEffective({ ...paths, env: {} })).toBe(
				false,
			);
		}
	});

	it("is not effective when a higher-precedence file declares the entry", async () => {
		for (const file of [
			"managed/managed-settings.json",
			"managed/managed-settings.d/10-org.json",
			"project/.claude/settings.json",
			"project/.claude/settings.local.json",
		]) {
			const paths = await layout({
				"user/settings.json": { extraKnownMarketplaces: entry(true) },
				[file]: { additionalMarketplaces: entry(true) },
			});
			expect(
				await isPluginAutoUpdateEffective({ ...paths, env: {} }),
				file,
			).toBe(false);
		}
	});

	it("follows the variables that turn off Claude Code updates", async () => {
		const paths = await layout({
			"user/settings.json": { extraKnownMarketplaces: entry(true) },
		});
		for (const name of [
			"DISABLE_UPDATES",
			"DISABLE_AUTOUPDATER",
			"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
		]) {
			expect(
				await isPluginAutoUpdateEffective({ ...paths, env: { [name]: "1" } }),
			).toBe(false);
			expect(
				await isPluginAutoUpdateEffective({
					...paths,
					env: { [name]: "1", FORCE_AUTOUPDATE_PLUGINS: "1" },
				}),
			).toBe(true);
		}
	});
});
