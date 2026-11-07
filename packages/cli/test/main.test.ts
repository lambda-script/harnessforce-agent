import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runCli } from "./support/cli.js";

const pkg = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

describe("harnessforce", () => {
	it("prints the package version for --version", async () =>
		expect(await runCli(["--version"])).toEqual({
			code: 0,
			out: `${pkg.version}\n`,
			err: "",
		}));

	it.each([
		[["unknown"], 2],
		[["otel-headers", "extra"], 1],
	])("rejects %j on stderr with exit code %i", async (argv, code) => {
		const r = await runCli(argv);
		expect(r.code).toBe(code);
		expect(r.out).toBe("");
		expect(r.err).toMatch(/Run "harnessforce (otel-headers )?--help"/);
	});

	// --urlは検証者と開発者の接続先の上書きで、利用者向けのusageには載せない（指定すれば動く）。
	it("does not advertise the hidden --url override in the usage", async () => {
		const r = await runCli(["--help"]);
		expect(r.out + r.err).not.toContain("--url");
		const help = await runCli(["login", "--help"]);
		expect(help.out + help.err).toContain("--port");
		expect(help.out + help.err).not.toContain("--url");
	});
});
