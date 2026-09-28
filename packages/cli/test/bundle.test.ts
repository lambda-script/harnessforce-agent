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
import { describe, expect, it } from "vitest";
import { tempDir } from "./config/support.js";

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

describe("built hf", () => {
	it("ships only the bin bundle and the build input, without declarations", () =>
		expect(readdirSync(dist, { recursive: true }).sort()).toEqual([
			"bin.js",
			"build-config.json",
		]));

	it("runs as an executable with node", () =>
		expect(binSource().startsWith("#!/usr/bin/env node\n")).toBe(true));

	it("imports only node builtins and the declared externals", () => {
		const packages = importedSpecifiers(binSource()).filter(
			(specifier) => !specifier.startsWith("node:"),
		);
		expect(new Set(packages)).toEqual(new Set(EXTERNALS));
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
});
