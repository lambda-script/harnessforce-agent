import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { UNSUPPORTED_NODE_WARNING } from "@harnessforce/agent-core/hook-warning";
import { parse } from "acorn";
import { describe, expect, it } from "vitest";

const source = readFileSync(
	new URL("../src/entry.cjs", import.meta.url),
	"utf8",
);

function runEntry(nodeVersion: string) {
	const required: string[] = [];
	const stderr: string[] = [];
	const stdout: string[] = [];
	runInNewContext(source, {
		process: {
			versions: { node: nodeVersion },
			stderr: { write: (text: string) => stderr.push(text) },
			stdout: { write: (text: string) => stdout.push(text) },
		},
		require: (id: string) => required.push(id),
	});
	return { required, stderr: stderr.join(""), stdout: stdout.join("") };
}

describe("hook entry", () => {
	// 18未満のNode.jsでも構文解析できることを、ES5の文法で確かめる（correlation.md「実行環境」）。
	it("parses as ES5 script", () =>
		expect(() =>
			parse(source, { ecmaVersion: 5, sourceType: "script" }),
		).not.toThrow());

	it.each([
		"16.20.2",
		"17.9.1",
		"0.12.18",
	])("skips without loading the main bundle on Node.js %s", (version) => {
		const result = runEntry(version);
		expect(result.required).toEqual([]);
		expect(JSON.parse(result.stdout)).toEqual({
			systemMessage: UNSUPPORTED_NODE_WARNING,
		});
		expect(result.stderr).toBe(
			"harnessforce: session registration skipped (unsupported node)\n",
		);
	});

	it.each([
		"18.0.0",
		"22.21.1",
		"24.1.0",
	])("loads the main bundle on Node.js %s", (version) => {
		const result = runEntry(version);
		expect(result.required).toEqual(["./harnessforce-hook-main.cjs"]);
		expect(result.stderr).toBe("");
	});
});
