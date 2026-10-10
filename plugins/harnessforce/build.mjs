import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	cpSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllowedUrl, underBase } from "@harnessforce/agent-core/url";
import { buildConfigFrom } from "@harnessforce/cli/scripts/build-config.mjs";
import { build } from "tsdown";
import { rawPlugin } from "../../packages/agent-core/raw-plugin.mjs";

const pluginDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(pluginDir, "../..");
const cliDir = join(repoRoot, "packages/cli");
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

/**
 * correlation.md「接続先」: MCP serverのURLとCLIの既定の接続先は、同じbuildの入力から作る。
 * 同梱するCLIが別の値でbuildされていれば、2つが食い違うため失敗させる。
 */
function connectionUrl() {
	const { url } = buildConfigFrom(process.env);
	const cliConfig = JSON.parse(
		readFileSync(join(cliDir, "dist/build-config.json"), "utf8"),
	);
	if (cliConfig.url !== url)
		throw new Error(
			"packages/cli was built with a different HARNESSFORCE_BUILD_URL; build it again with the same value",
		);
	return parseAllowedUrl(url);
}

const mcpJson = (connection) => ({
	mcpServers: {
		harnessforce: { type: "http", url: underBase(connection, "mcp").href },
	},
});

/**
 * environments.md「接続先」: stagingの検証者は、CLIも同じbuildの出力から導入する。
 * CLIが依存するsemconvはnpmに無い場合があるため、同じversionのtarballを一緒に置く。
 * `pnpm pack`はworkspaceの依存をそのversionへ書き換える。
 */
function packCli(destination) {
	const pnpm = process.env.npm_execpath;
	if (!pnpm) throw new Error("Run the plugin build through pnpm (pnpm build)");
	const [command, prefix] = /\.[cm]?js$/.test(pnpm)
		? [process.execPath, [pnpm]]
		: [pnpm, []];
	return ["packages/semconv", "packages/cli"].map((dir) => {
		const packed = execFileSync(
			command,
			[...prefix, "pack", "--json", "--pack-destination", destination],
			{ cwd: join(repoRoot, dir), encoding: "utf8" },
		);
		return basename(JSON.parse(packed).filename);
	});
}

// public（repositoryのcopy）はnpmのCLIを導入する。buildの出力のsetupは、同梱したtarballを導入する。
const NPM_INSTALL = "npm install -g @harnessforce/cli";

function writeSetupCommand(to, tarballs) {
	const source = readFileSync(join(pluginDir, "commands/setup.md"), "utf8");
	if (!source.includes(NPM_INSTALL))
		throw new Error(`commands/setup.md must contain "${NPM_INSTALL}"`);
	const shipped = tarballs
		.map((tarball) => `"${PLUGIN_ROOT}/cli/${tarball}"`)
		.join(" ");
	mkdirSync(dirname(to), { recursive: true });
	writeFileSync(to, source.replace(NPM_INSTALL, `npm install -g ${shipped}`));
}

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
	const connection = connectionUrl();
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
	cpSync(join(pluginDir, "skills"), join(plugin, "skills"), {
		recursive: true,
	});
	// setup以外のcommandはそのまま写す。setupは下で同梱のCLIを導入する内容に置き換える。
	cpSync(join(pluginDir, "commands"), join(plugin, "commands"), {
		recursive: true,
	});
	writeFileSync(
		join(plugin, ".mcp.json"),
		`${JSON.stringify(mcpJson(connection), null, 2)}\n`,
	);
	mkdirSync(join(plugin, "hooks"), { recursive: true });
	writeFileSync(
		join(plugin, "hooks/hooks.json"),
		`${JSON.stringify(hooksJson(), null, 2)}\n`,
	);
	writeSetupCommand(
		join(plugin, "commands/setup.md"),
		packCli(join(plugin, "cli")),
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
		plugins: [rawPlugin()],
		dts: false,
		logLevel: "warn",
	});
}

await buildMarketplace();
