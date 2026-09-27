import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { run } from "../src/main.js";

const pkg = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

function capture(argv: string[]) {
	const out: string[] = [];
	const err: string[] = [];
	const code = run(argv, {
		stdout: (s) => out.push(s),
		stderr: (s) => err.push(s),
	});
	return { code, out: out.join(""), err: err.join("") };
}

describe("hf", () => {
	it("prints the package version for --version", () =>
		expect(capture(["--version"])).toEqual({
			code: 0,
			out: `${pkg.version}\n`,
			err: "",
		}));

	it("rejects anything else with usage on stderr", () => {
		const r = capture(["init"]);
		expect(r.code).toBe(1);
		expect(r.out).toBe("");
		expect(r.err).toContain("Usage: hf --version");
	});
});
