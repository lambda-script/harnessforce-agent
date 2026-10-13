import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// turboはtestの前にこのpackageのbuildを実行する。直接vitestを実行する場合は先に`pnpm build`する。
const npmDir = fileURLToPath(new URL("../dist/npm", import.meta.url));
const pluginDir = fileURLToPath(new URL("..", import.meta.url));
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const source = readJson(join(pluginDir, "package.json"));
const built = readJson(join(npmDir, "package.json"));

// environments.md「接続先」: `@harnessforce/claude-code-plugin`はbuildの出力を中身とし、CLIのtarballを同梱しない。
describe("@harnessforce/claude-code-plugin", () => {
	it("is published from the build output by the release workflow", () => {
		expect(source.name).toBe("@harnessforce/claude-code-plugin");
		expect(source.private).toBeUndefined();
		expect(source.publishConfig).toEqual({
			access: "public",
			provenance: true,
			directory: "dist/npm",
		});
	});

	it("declares the registry metadata that links the package to the repository", () => {
		expect(built).toMatchObject({
			name: source.name,
			version: source.version,
			license: "Apache-2.0",
			repository: {
				type: "git",
				url: "git+https://github.com/lambda-script/harnessforce-agent.git",
				directory: "plugins/harnessforce",
			},
			publishConfig: { access: "public", provenance: true },
			engines: { node: ">=18" },
		});
		expect(built.publishConfig).not.toHaveProperty("directory");
	});

	// 名前の衝突を避けるため、pluginはbinを持たない（hfの別名を含む。correlation.md「コマンド名」）。
	it("exposes no bin and no scripts, dependencies or dev dependencies", () => {
		for (const field of ["bin", "scripts", "dependencies", "devDependencies"])
			expect(built).not.toHaveProperty(field);
	});

	it("has the plugin at the package root, which the marketplace installs as the plugin", () => {
		expect(readdirSync(npmDir, { recursive: true })).toEqual(
			expect.arrayContaining([
				".claude-plugin/plugin.json",
				".mcp.json",
				"hooks/hooks.json",
				"scripts/harnessforce-hook.cjs",
				"scripts/harnessforce-hook-main.cjs",
				"skills/record-run/SKILL.md",
				"commands/setup.md",
				"commands/tune.md",
				"LICENSE",
				"README.md",
			]),
		);
	});

	// 配られるpluginのversionと、changesetsが上げるpackageのversionを食い違わせない。
	it("reports the package version as the plugin version", () =>
		expect(readJson(join(npmDir, ".claude-plugin/plugin.json")).version).toBe(
			source.version,
		));

	it("does not ship the CLI tarballs, and setup installs the CLI from npm", () => {
		expect(existsSync(join(npmDir, "cli"))).toBe(false);
		expect(readFileSync(join(npmDir, "commands/setup.md"), "utf8")).toBe(
			readFileSync(join(pluginDir, "commands/setup.md"), "utf8"),
		);
	});

	// 値を与えないbuildの出力。実行時のHARNESSFORCE_URLで上書きできる形のままにする。
	it("points the MCP server at the production default, overridable by HARNESSFORCE_URL", () =>
		expect(
			readJson(join(npmDir, ".mcp.json")).mcpServers.harnessforce.url,
		).toBe(
			// biome-ignore lint/suspicious/noTemplateCurlyInString: JSのtemplateではなくClaude Codeの環境変数の展開である。
			"${HARNESSFORCE_URL:-https://harnessforce.dev}/mcp",
		));

	it("packs the dot-directory and every file of the plugin", () => {
		const [{ files }] = JSON.parse(
			execFileSync("npm", ["pack", "--dry-run", "--json"], {
				cwd: npmDir,
				encoding: "utf8",
				shell: process.platform === "win32",
			}),
		);
		const packed = files.map((file: { path: string }) => file.path);
		expect(packed).toEqual(
			expect.arrayContaining([
				".claude-plugin/plugin.json",
				".mcp.json",
				"hooks/hooks.json",
				"scripts/harnessforce-hook.cjs",
				"package.json",
			]),
		);
	});
});
