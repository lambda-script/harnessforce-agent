import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsdown";

const pluginDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(pluginDir, "../..");
const HOOK_ENTRY = "scripts/harnessforce-hook.cjs";
// Claude Codeがexec形式のargsで展開するplaceholder。
// biome-ignore lint/suspicious/noTemplateCurlyInString: JSのtemplateではなくClaude Codeのplaceholderである。
const PLUGIN_ROOT = "${CLAUDE_PLUGIN_ROOT}";
// scriptが止まった場合の保険（秒）。本体はgit 1秒、送信2秒で打ち切る。
const HOOK_TIMEOUT_SECONDS = 10;
const EVENTS = {
	SessionStart: "session-start",
	UserPromptSubmit: "user-prompt-submit",
};

const hooksJson = () => ({
	description: "Register Claude Code sessions with Harnessforce",
	hooks: Object.fromEntries(
		Object.entries(EVENTS).map(([event, arg]) => [
			event,
			[
				{
					hooks: [
						{
							type: "command",
							command: "node",
							args: [`${PLUGIN_ROOT}/${HOOK_ENTRY}`, arg],
							timeout: HOOK_TIMEOUT_SECONDS,
						},
					],
				},
			],
		]),
	),
});

function copy(from, to) {
	mkdirSync(dirname(to), { recursive: true });
	copyFileSync(from, to);
}

/**
 * dist/marketplaceに、localのmarketplaceとして登録できるdirectoryを作る
 * （environments.md「接続先」: stagingの検証者はbuildの出力を`/plugin marketplace add`する）。
 * repositoryのhooks/hooks.jsonは空のままにし、scriptを持つこの出力にだけhookを配線する。
 */
async function buildMarketplace() {
	const outDir = join(pluginDir, "dist/marketplace");
	const plugin = join(outDir, "plugins/harnessforce");
	rmSync(outDir, { recursive: true, force: true });
	copy(
		join(repoRoot, ".claude-plugin/marketplace.json"),
		join(outDir, ".claude-plugin/marketplace.json"),
	);
	copy(
		join(pluginDir, ".claude-plugin/plugin.json"),
		join(plugin, ".claude-plugin/plugin.json"),
	);
	copy(join(repoRoot, "LICENSE"), join(plugin, "LICENSE"));
	mkdirSync(join(plugin, "hooks"), { recursive: true });
	writeFileSync(
		join(plugin, "hooks/hooks.json"),
		`${JSON.stringify(hooksJson(), null, 2)}\n`,
	);
	copy(join(pluginDir, "src/entry.cjs"), join(plugin, HOOK_ENTRY));
	await build({
		config: false,
		cwd: pluginDir,
		entry: { "harnessforce-hook-main": join(pluginDir, "src/main.ts") },
		outDir: join(plugin, "scripts"),
		// outDirには先に写したentryがある。出力全体の掃除は冒頭のrmSyncが担う。
		clean: false,
		platform: "node",
		format: "cjs",
		fixedExtension: true,
		target: "node18",
		dts: false,
		logLevel: "warn",
	});
}

await buildMarketplace();
