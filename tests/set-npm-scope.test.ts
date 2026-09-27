import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyScope } from "../scripts/set-npm-scope.mjs";

describe("applyScope", () => {
	it("renames every package and internal dependency to config.npmScope", () => {
		const dir = mkdtempSync(join(tmpdir(), "scope-"));
		cpSync(new URL("../packages", import.meta.url), join(dir, "packages"), {
			recursive: true,
			filter: (p) => !p.includes("node_modules"),
		});
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({ config: { npmScope: "@acme-hf" } }),
		);
		writeFileSync(join(dir, "README.md"), "npm i @harnessforce/cli\n");

		applyScope(dir);

		const name = (p: string) =>
			JSON.parse(readFileSync(join(dir, "packages", p, "package.json"), "utf8"))
				.name;
		expect([name("semconv"), name("cli")]).toEqual([
			"@acme-hf/semconv",
			"@acme-hf/cli",
		]);
		// sourceがpackage名でimportする内部依存も、新しいscopeで解決される。
		const launch = readFileSync(
			join(dir, "packages", "cli", "src", "run", "launch.ts"),
			"utf8",
		);
		expect(launch).toContain('from "@acme-hf/semconv"');
		expect(launch).not.toContain("@harnessforce/");
		expect(readFileSync(join(dir, "README.md"), "utf8")).toBe(
			"npm i @acme-hf/cli\n",
		);
	});
});
