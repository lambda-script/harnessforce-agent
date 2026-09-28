import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// turboはtestの前にCLIとこのpackageをbuildする。直接vitestを実行する場合は先に`pnpm build`する。
const buildScript = fileURLToPath(new URL("../build.mjs", import.meta.url));
const cliBuildUrl: string = JSON.parse(
	readFileSync(
		new URL("../../../packages/cli/dist/build-config.json", import.meta.url),
		"utf8",
	),
).url;

function buildWith(input: Record<string, string>) {
	return spawnSync(process.execPath, [buildScript], {
		env: { PATH: process.env.PATH ?? "", ...input },
		encoding: "utf8",
	});
}

describe("plugin build input", () => {
	// correlation.md「接続先」: 値を与えないbuildは失敗し、既定値で補わない。
	it.each([
		[{}],
		[{ HARNESSFORCE_BUILD_URL: "" }],
		[{ HARNESSFORCE_BUILD_URL: "http://app.example.test" }],
	])("fails without an allowed HARNESSFORCE_BUILD_URL: %j", (input) => {
		const result = buildWith(input);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("HARNESSFORCE_BUILD_URL");
	});

	// 同じ値を別の場所に書かない: 同梱するCLIの既定の接続先とMCP serverのURLが食い違うbuildを作らない。
	it("fails when the CLI was built with another connection URL", () => {
		const result = buildWith({
			HARNESSFORCE_BUILD_URL: `${cliBuildUrl.replace(/\/+$/, "")}/other`,
		});
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("HARNESSFORCE_BUILD_URL");
	});
});
