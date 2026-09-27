import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) =>
	JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const scope = read("package.json").config.npmScope as string;
const packages = readdirSync(new URL("../packages", import.meta.url)).map(
	(dir) => ({
		dir,
		pkg: read(`packages/${dir}/package.json`),
	}),
);

describe("release contract", () => {
	it.each(packages)("$dir uses the single npm scope", ({ dir, pkg }) =>
		expect(pkg.name).toBe(`${scope}/${dir}`));

	it.each(
		packages,
	)("$dir declares repository with directory and public provenance", ({
		dir,
		pkg,
	}) => {
		expect(pkg.repository).toEqual({
			type: "git",
			url: "git+https://github.com/lambda-script/harnessforce-agent.git",
			directory: `packages/${dir}`,
		});
		expect(pkg.publishConfig).toEqual({ access: "public", provenance: true });
		expect(pkg.license).toBe("Apache-2.0");
		expect(pkg.files).toEqual(["dist"]);
	});
});

describe("release workflow", () => {
	const yml = readFileSync(
		new URL("../.github/workflows/release.yml", import.meta.url),
		"utf8",
	);

	it("stays disabled until the repository variable enables it", () =>
		expect(yml).toContain("if: vars.NPM_PUBLISH_ENABLED == 'true'"));
	it("grants OIDC for provenance on a GitHub-hosted runner", () => {
		expect(yml).toContain("id-token: write");
		expect(yml).toMatch(/runs-on: ubuntu-/);
	});
	it("passes the npm credential by an explicit secret name", () => {
		expect(yml).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}");
		expect(yml).not.toContain("secrets: inherit");
	});
	it("verifies the registry after publishing", () =>
		expect(yml).toContain("node scripts/verify-published.mjs"));
});
