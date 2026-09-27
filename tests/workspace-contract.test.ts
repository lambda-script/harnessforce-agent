import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) =>
	JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const root = read("package.json");
const workspaces = ["packages", "plugins"].flatMap((parent) =>
	readdirSync(new URL(`../${parent}`, import.meta.url)).map((name) => ({
		dir: `${parent}/${name}`,
		pkg: read(`${parent}/${name}/package.json`),
	})),
);
const tasks = ["lint", "typecheck", "test", "build"] as const;

describe("turborepo workspace", () => {
	// turboはscriptを持たないpackageを黙ってskipするため、欠落はgateの抜けになる。
	it.each(workspaces)("$dir defines every pipeline task", ({ pkg }) => {
		for (const task of tasks) expect(pkg.scripts?.[task]).toBeTypeOf("string");
	});

	it.each(tasks)("root %s runs through turbo", (task) =>
		expect(root.scripts[task]).toMatch(new RegExp(`^turbo run ${task}\\b`)));

	it("caches build output so a cache hit restores dist", () => {
		expect(existsSync(new URL("../turbo.json", import.meta.url))).toBe(true);
		expect(read("turbo.json").tasks.build.outputs).toContain("dist/**");
	});

	it("builds through turbo before publishing", () =>
		expect(root.scripts.release).toMatch(
			/^turbo run build\b.*&& changeset publish$/,
		));
});
