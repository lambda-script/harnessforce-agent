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
import { rawPlugin } from "@harnessforce/agent-core/raw-plugin";
import { parseAllowedUrl, withoutExtras } from "@harnessforce/agent-core/url";
import { buildConfigFrom } from "@harnessforce/cli/scripts/build-config.mjs";
import { build } from "tsdown";

const pluginDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(pluginDir, "../..");
const cliDir = join(repoRoot, "packages/cli");
const HOOK_ENTRY = "scripts/harnessforce-hook.cjs";
// Claude Codeがexec形式のargsで展開するplaceholder。
// biome-ignore lint/suspicious/noTemplateCurlyInString: JSのtemplateではなくClaude Codeのplaceholderである。
const PLUGIN_ROOT = "${CLAUDE_PLUGIN_ROOT}";
// scriptが止まった場合の保険（秒）。本体はgit 1秒、送信2秒で打ち切る。async hookにはtimeoutが強制されない。
const HOOK_TIMEOUT_SECONDS = 10;
// correlation.md「数えるhook」: Skill、Agent（旧名Task）とMCPのtoolだけを数える。src/usage/count.tsが数えるtoolと揃える。
const COUNTED_TOOLS = "^(Skill|Agent|Task)$|^mcp__";
// correlation.md「sessionの作業位置」: 作業位置を観測するtool。数えるhookとは別のgroupにする。
const EDITING_TOOLS = "^(Write|Edit)$";
// eventごとのgroupの配列。
const EVENTS = {
	SessionStart: [{ arg: "session-start" }],
	UserPromptSubmit: [{ arg: "user-prompt-submit" }],
	SessionEnd: [{ arg: "session-end" }],
	// 数えるhookと作業位置のhookはagentを待たせない。
	PostToolUse: [
		{ arg: "post-tool-use", matcher: COUNTED_TOOLS, async: true },
		{ arg: "work-location", matcher: EDITING_TOOLS, async: true },
	],
	PostToolUseFailure: [
		{ arg: "post-tool-use-failure", matcher: COUNTED_TOOLS, async: true },
	],
	UserPromptExpansion: [{ arg: "user-prompt-expansion", async: true }],
	PermissionRequest: [{ arg: "permission-request", async: true }],
	PostCompact: [{ arg: "post-compact", async: true }],
	CwdChanged: [{ arg: "cwd-changed", async: true }],
	Stop: [{ arg: "stop", async: true }],
};

const hooksJson = () => ({
	description:
		"Register Claude Code sessions with Harnessforce and send their usage summaries and work locations",
	hooks: Object.fromEntries(
		Object.entries(EVENTS).map(([event, groups]) => [
			event,
			groups.map(({ arg, matcher, async }) => ({
				...(matcher ? { matcher } : {}),
				hooks: [
					{
						type: "command",
						command: "node",
						args: [`${PLUGIN_ROOT}/${HOOK_ENTRY}`, arg],
						...(async ? { async } : { timeout: HOOK_TIMEOUT_SECONDS }),
					},
				],
			})),
		]),
	),
});

/**
 * correlation.md「接続先」: MCP serverのURLの既定値とCLIの既定の接続先は、同じbuildの入力から作る。
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

// correlation.md「接続先」: buildし直さずに、環境変数HARNESSFORCE_URL（user settingsのenvを含む）で宛先を上書きできる形にする。
const MCP_URL_OVERRIDE = "${HARNESSFORCE_URL:-";

const mcpJson = (connection) => ({
	mcpServers: {
		harnessforce: {
			type: "http",
			url: `${MCP_URL_OVERRIDE}${withoutExtras(connection)}}/mcp`,
		},
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

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/**
 * pluginの本体（plugin.json、skill、command、`.mcp.json`、hook）を`plugin`に書く。
 * npmへpublishするpackageのroot（dist/npm）と、localのmarketplaceの中のplugin（dist/marketplace）は、この内容を共有する。
 * repositoryのhooks/hooks.jsonは空のままにし、scriptを持つこの出力にだけhookを配線する。
 */
async function writePlugin(plugin, connection, version) {
	rmSync(plugin, { recursive: true, force: true });
	// changesetsが上げるのはpackage.jsonのversionだけであるため、配るpluginのversionをそれに合わせる。
	mkdirSync(join(plugin, ".claude-plugin"), { recursive: true });
	writeFileSync(
		join(plugin, ".claude-plugin/plugin.json"),
		`${JSON.stringify({ ...readJson(join(pluginDir, ".claude-plugin/plugin.json")), version }, null, 2)}\n`,
	);
	copy(join(repoRoot, "LICENSE"), join(plugin, "LICENSE"));
	cpSync(join(pluginDir, "skills"), join(plugin, "skills"), {
		recursive: true,
	});
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
	copy(join(pluginDir, "src/entry.cjs"), join(plugin, HOOK_ENTRY));
	await build({
		config: false,
		cwd: pluginDir,
		entry: { "harnessforce-hook-main": join(pluginDir, "src/main.ts") },
		outDir: join(plugin, "scripts"),
		// outDirには先に写したentryがある。
		clean: false,
		platform: "node",
		format: "cjs",
		fixedExtension: true,
		target: "node18",
		plugins: [rawPlugin()],
		// client-updates.md「版の申告」: hookの`User-Agent`に載せる版と、接続先を与えたbuildか。
		define: {
			__HF_PLUGIN_VERSION__: JSON.stringify(version),
			__HF_DEV_BUILD__: JSON.stringify(!buildConfigFrom(process.env).isDefault),
		},
		dts: false,
		logLevel: "warn",
	});
}

/**
 * environments.md「接続先」: npmへpublishする`@harnessforce/claude-code-plugin`。
 * dist/npmがpackageのrootであり（package.jsonの`publishConfig.directory`）、CLIのtarballは同梱しない。
 */
async function buildNpmPackage(connection) {
	const outDir = join(pluginDir, "dist/npm");
	const manifest = readJson(join(pluginDir, "package.json"));
	await writePlugin(outDir, connection, manifest.version);
	copy(join(pluginDir, "README.md"), join(outDir, "README.md"));
	// directoryはsource側がpublishするdirectoryを指す設定であり、publishされるpackageには含めない。
	const publishConfig = Object.fromEntries(
		Object.entries(manifest.publishConfig).filter(
			([key]) => key !== "directory",
		),
	);
	writeFileSync(
		join(outDir, "package.json"),
		`${JSON.stringify(
			{
				name: manifest.name,
				version: manifest.version,
				description: manifest.description,
				keywords: manifest.keywords,
				license: manifest.license,
				homepage: manifest.homepage,
				bugs: manifest.bugs,
				repository: manifest.repository,
				publishConfig,
				engines: manifest.engines,
			},
			null,
			"\t",
		)}\n`,
	);
}

/**
 * dist/marketplaceに、localのmarketplaceとして登録できるdirectoryを作る
 * （environments.md「接続先」: 開発者はbuildの出力を`/plugin marketplace add`する）。
 * npmのpackageと同じpluginに、同じbuildのCLIとsemconvのtarballを足し、setupがそれを導入する形にする。
 */
async function buildMarketplace() {
	const outDir = join(pluginDir, "dist/marketplace");
	const plugin = join(outDir, "plugins/harnessforce");
	rmSync(outDir, { recursive: true, force: true });
	copy(
		join(repoRoot, ".claude-plugin/marketplace.json"),
		join(outDir, ".claude-plugin/marketplace.json"),
	);
	cpSync(join(pluginDir, "dist/npm"), plugin, {
		recursive: true,
		filter: (from) => !["package.json", "README.md"].includes(basename(from)),
	});
	writeSetupCommand(
		join(plugin, "commands/setup.md"),
		packCli(join(plugin, "cli")),
	);
}

const connection = connectionUrl();
await buildNpmPackage(connection);
await buildMarketplace();
