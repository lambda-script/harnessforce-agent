import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const read = (p: string) =>
	JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
// privateのpackageはchangesetsが公開しない。
const packages = readdirSync(new URL("../packages", import.meta.url))
	.map((dir) => ({ dir, pkg: read(`packages/${dir}/package.json`) }))
	.filter(({ pkg }) => !pkg.private);

const atLeast = (version: string, minimum: string) => {
	const [a = 0, b = 0, c = 0] = version.split(".").map(Number);
	const [x = 0, y = 0, z = 0] = minimum.split(".").map(Number);
	return a !== x ? a > x : b !== y ? b > y : c >= z;
};

describe("release contract", () => {
	it.each(packages)("$dir uses the @harnessforce npm scope", ({ dir, pkg }) =>
		expect(pkg.name).toBe(`@harnessforce/${dir}`));

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

	// npmはfilesに関係なくpackageのREADMEを同梱し、package pageに表示する。
	it.each(packages)("$dir links its npm page to the repository", ({
		dir,
		pkg,
	}) => {
		expect(pkg.homepage).toBe(
			`https://github.com/lambda-script/harnessforce-agent/tree/main/packages/${dir}#readme`,
		);
		expect(pkg.bugs).toEqual({
			url: "https://github.com/lambda-script/harnessforce-agent/issues",
		});
		expect(pkg.keywords).toEqual(expect.arrayContaining(["harnessforce"]));
		expect(
			existsSync(new URL(`../packages/${dir}/README.md`, import.meta.url)),
		).toBe(true);
	});

	// npmはpackageのdirectoryにあるLICENSEだけを同梱し、rootのLICENSEは同梱しない。
	it.each(packages)("$dir ships the repository license", ({ dir }) =>
		expect(
			readFileSync(
				new URL(`../packages/${dir}/LICENSE`, import.meta.url),
				"utf8",
			),
		).toBe(readFileSync(new URL("../LICENSE", import.meta.url), "utf8")));

	// correlation.md「実行環境」: hookが使う端末のNode.js 18以上でhfを起動し、hfはsemconvを実行時に読む。
	it.each(packages)("$dir runs on Node.js 18 and later", ({ pkg }) =>
		expect(pkg.engines).toEqual({ node: ">=18" }));
});

// 公開の手順はrunbookにだけ書き、release.ymlのcommentはそこを指す（document-classes）。
const RUNBOOK = "docs/runbooks/releasing.md";
const readRunbook = () =>
	readFileSync(new URL(`../${RUNBOOK}`, import.meta.url), "utf8");

describe("release workflow", () => {
	const yml = readFileSync(
		new URL("../.github/workflows/release.yml", import.meta.url),
		"utf8",
	);

	const steps: {
		id?: string;
		uses?: string;
		run?: string;
		with?: Record<string, unknown>;
	}[] = parse(yml).jobs.release.steps;

	it("stays disabled until the repository variable enables it", () =>
		expect(yml).toContain("if: vars.NPM_PUBLISH_ENABLED == 'true'"));
	it("grants OIDC for provenance on a GitHub-hosted runner", () => {
		expect(yml).toContain("id-token: write");
		expect(yml).toMatch(/runs-on: ubuntu-/);
	});
	it("publishes by trusted publishing instead of a long-lived npm token", () => {
		expect(yml).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|secrets: inherit/);
		// setup-nodeのregistry-urlは環境変数のtokenを読む.npmrcを書き、OIDCで得たtokenと競合する。
		for (const step of steps)
			if (step.uses?.startsWith("actions/setup-node@"))
				expect(step.with).not.toHaveProperty("registry-url");
	});
	// npmのtrusted publishingはnpm 11.5.1以上とNode.js 22.14.0以上を要する。
	it("publishes with an npm and a Node.js that support trusted publishing", () => {
		const upgrade = steps.findIndex((step) =>
			/^npm install -g npm@\d+\.\d+\.\d+$/.test(step.run ?? ""),
		);
		expect(upgrade).toBeGreaterThan(-1);
		expect(upgrade).toBeLessThan(
			steps.findIndex((step) => step.id === "changesets"),
		);
		const npm = steps[upgrade]?.run?.split("@")[1] ?? "";
		expect(atLeast(npm, "11.5.1")).toBe(true);
		const node = readFileSync(
			new URL("../.node-version", import.meta.url),
			"utf8",
		).trim();
		expect(atLeast(node, "22.14.0")).toBe(true);
	});
	// environments.md「接続先」: CLIの接続先はbuildの入力として1か所で与え、既定値で補わない。
	it("builds the CLI with the connection URL from the repository variable", () =>
		expect(yml).toContain(
			"HARNESSFORCE_BUILD_URL: ${{ vars.HARNESSFORCE_BUILD_URL }}",
		));
	// environments.md「接続先」: 一般への配布はproductionのドメインが記録されるまで対象外とする。
	it("documents that publishing waits for the production domain", () => {
		expect(yml).toMatch(
			/# .*productionのドメイン.*\n(?:\s+#.*\n)*\s+if: vars\.NPM_PUBLISH_ENABLED/,
		);
		const releasing = readRunbook();
		expect(releasing).toMatch(
			/^Publishing to npmjs is disabled until the production domain is recorded/m,
		);
	});
	it("documents trusted publishing as the npm credential", () => {
		const releasing = readRunbook();
		expect(releasing).toContain("trusted publisher");
		expect(releasing).not.toContain("NPM_TOKEN");
	});
	it("points its comments at the release runbook", () => {
		expect(yml).toContain(RUNBOOK);
		expect(yml).not.toContain("README");
	});
	it("verifies the registry after publishing", () =>
		expect(yml).toContain("node scripts/verify-published.mjs"));
	// semantic-conventions.md「目的」: 最初の公開を0.1.0にするため、version PRを作る前に確かめる。
	it("checks the first release before changesets bumps a version", () => {
		const check = steps.findIndex(
			(step) => step.run === "node scripts/check-first-release.mjs",
		);
		expect(check).toBeGreaterThan(-1);
		expect(check).toBeLessThan(
			steps.findIndex((step) => step.id === "changesets"),
		);
	});
	it("documents that the first release publishes 0.1.0 without changesets", () =>
		expect(readRunbook()).toMatch(
			/Until `@harnessforce\/<name>@0\.1\.0` is on npm, do not add a changeset/,
		));
});
