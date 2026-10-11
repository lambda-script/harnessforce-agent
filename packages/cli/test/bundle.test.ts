import { execFileSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	symlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { usingHarnessforceBody } from "@harnessforce/agent-core/using-harnessforce";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { describe, expect, it } from "vitest";

// turboはtestの前にこのpackageのbuildを実行する。直接vitestを実行する場合は先に`pnpm build`する。
const packageDir = fileURLToPath(new URL("..", import.meta.url));
const dist = join(packageDir, "dist");
const binSource = () => readFileSync(join(dist, "bin.js"), "utf8");
// 実行時に解決させる依存。native moduleと、利用者が型と共に読む公開packageである。
const EXTERNALS = ["@harnessforce/semconv", "@napi-rs/keyring"];

const importedSpecifiers = (source: string) =>
	[...source.matchAll(/(?:\bfrom|\bimport\s*\()\s*["']([^"']+)["']/g)].map(
		([, specifier]) => specifier as string,
	);

describe("built harnessforce", () => {
	it("ships only the bin bundle and the build input, without declarations", () =>
		expect(readdirSync(dist, { recursive: true }).sort()).toEqual([
			"bin.js",
			"build-config.json",
		]));

	it("runs as an executable with node", () =>
		expect(binSource().startsWith("#!/usr/bin/env node\n")).toBe(true));

	// correlation.md「コマンド名」: `bin`を指定しない`npm exec`は先頭の`bin`を選ぶため、`harnessforce`を先頭に置く。
	// `hf`は最初のnpm publishより前のbuildだけが持つ別名であり、publishを有効にする前に外す（docs/runbooks/releasing.md）。
	it("exposes harnessforce first and hf as the alias for the same executable", () => {
		const manifest = JSON.parse(
			readFileSync(join(packageDir, "package.json"), "utf8"),
		);
		expect(Object.entries(manifest.bin)).toEqual([
			["harnessforce", "./dist/bin.js"],
			["hf", "./dist/bin.js"],
		]);
	});

	it("imports only node builtins and the declared externals", () => {
		const packages = importedSpecifiers(binSource()).filter(
			(specifier) => !specifier.startsWith("node:"),
		);
		expect(new Set(packages)).toEqual(new Set(EXTERNALS));
	});

	// agent-coreはnpmへ公開しないため、公開するtarball（package.jsonとdist）から参照させない。
	it("keeps the private agent-core out of the published package", () => {
		const manifest = JSON.parse(
			readFileSync(join(packageDir, "package.json"), "utf8"),
		);
		for (const field of [
			"dependencies",
			"optionalDependencies",
			"peerDependencies",
		])
			expect(manifest[field] ?? {}).not.toHaveProperty(
				"@harnessforce/agent-core",
			);
		for (const file of readdirSync(dist, { recursive: true }))
			expect(readFileSync(join(dist, String(file)), "utf8")).not.toContain(
				"@harnessforce/agent-core",
			);
	});

	// 依存packageのうち外部に残したものだけを置いた場所で起動し、それ以外をbundleに取り込んだことを確かめる。
	it("prints its version with only the externals installed", () => {
		const installed = join(tempDir("hf-cli-bundle-"), "cli");
		cpSync(dist, join(installed, "dist"), { recursive: true });
		cpSync(join(packageDir, "package.json"), join(installed, "package.json"));
		for (const name of EXTERNALS) {
			const link = join(installed, "node_modules", name);
			mkdirSync(dirname(link), { recursive: true });
			symlinkSync(realpathSync(join(packageDir, "node_modules", name)), link);
		}
		const { version } = JSON.parse(
			readFileSync(join(packageDir, "package.json"), "utf8"),
		);
		expect(
			execFileSync(process.execPath, [
				join(installed, "dist/bin.js"),
				"--version",
			]).toString(),
		).toBe(`${version}\n`);
	});

	// correlation.md「using-harnessforce」: buildしたbundleが、実行時にfileを読まずに本文を注入する。
	it("injects the using-harnessforce body from the bundle alone", () => {
		const home = tempDir("hf-cli-hook-home-");
		const out = execFileSync(
			process.execPath,
			[join(dist, "bin.js"), "hook", "session-start"],
			{
				input: JSON.stringify({
					session_id: "s-1",
					cwd: home,
					source: "resume",
				}),
				env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home },
			},
		).toString();
		expect(JSON.parse(out).hookSpecificOutput.additionalContext).toBe(
			`harnessforce session_id: s-1\n\n${usingHarnessforceBody}`,
		);
	});
});
