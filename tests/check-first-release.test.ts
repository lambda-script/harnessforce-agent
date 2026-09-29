import { describe, expect, it } from "vitest";
import {
	checkFirstRelease,
	parseChangeset,
} from "../scripts/check-first-release.mjs";

// semantic-conventions.md「目的」「互換性」: 最初の公開は0.1.0とし、本体はnpmに0.1.0が載ったことで切り替える。
describe("parseChangeset", () => {
	it("reads the package names from the frontmatter", () =>
		expect(
			parseChangeset(
				'---\n"@harnessforce/semconv": patch\n"@harnessforce/cli": minor\n---\n\nText.\n',
			),
		).toEqual(["@harnessforce/semconv", "@harnessforce/cli"]));

	it("reads single-quoted and bare names", () =>
		expect(
			parseChangeset("---\n'@harnessforce/cli': patch\nfoo: major\n---\n"),
		).toEqual(["@harnessforce/cli", "foo"]));

	it("returns no names for an empty changeset", () =>
		expect(parseChangeset("---\n---\n")).toEqual([]));
});

describe("checkFirstRelease", () => {
	const packages = [
		{ name: "@harnessforce/semconv", version: "0.1.0" },
		{ name: "@harnessforce/cli", version: "0.1.0" },
	];
	const notOnRegistry = async () => false;
	const onRegistry = async () => true;

	it("passes before the first release when no changeset is pending", async () =>
		await expect(
			checkFirstRelease({
				packages,
				changesets: [],
				isPublished: notOnRegistry,
			}),
		).resolves.toBeUndefined());

	it("fails before the first release when a changeset would bump 0.1.0", async () =>
		await expect(
			checkFirstRelease({
				packages,
				changesets: [
					{ file: "cli-token-refresh.md", names: ["@harnessforce/cli"] },
				],
				isPublished: notOnRegistry,
			}),
		).rejects.toThrow("@harnessforce/cli (cli-token-refresh.md)"));

	it("fails when an unreleased package is not at 0.1.0", async () =>
		await expect(
			checkFirstRelease({
				packages: [{ name: "@harnessforce/semconv", version: "0.1.1" }],
				changesets: [],
				isPublished: notOnRegistry,
			}),
		).rejects.toThrow("@harnessforce/semconv is 0.1.1"));

	it("allows changesets once 0.1.0 is on the registry", async () =>
		await expect(
			checkFirstRelease({
				packages: [{ name: "@harnessforce/cli", version: "0.1.0" }],
				changesets: [{ file: "fix.md", names: ["@harnessforce/cli"] }],
				isPublished: onRegistry,
			}),
		).resolves.toBeUndefined());

	it("asks the registry for the 0.1.0 of each package", async () => {
		const asked: string[] = [];
		await checkFirstRelease({
			packages,
			changesets: [],
			isPublished: async (spec) => {
				asked.push(spec);
				return true;
			},
		});
		expect(asked).toEqual([
			"@harnessforce/semconv@0.1.0",
			"@harnessforce/cli@0.1.0",
		]);
	});
});
