import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runCli } from "./support/cli.js";

const pkg = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

describe("hf", () => {
	it("prints the package version for --version", async () =>
		expect(await runCli(["--version"])).toEqual({
			code: 0,
			out: `${pkg.version}\n`,
			err: "",
		}));

	it.each([
		[[]],
		[["unknown"]],
		[["otel-headers", "extra"]],
	])("rejects %j with usage on stderr", async (argv) => {
		const r = await runCli(argv);
		expect(r.code).toBe(1);
		expect(r.out).toBe("");
		expect(r.err).toContain("Usage: hf");
	});
});
