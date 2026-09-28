import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) =>
	JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));

describe("runtime contract", () => {
	// correlation.md「実行環境」: hookは端末のNode.js 18以上で`hf otel-headers`を起動し、setupも18以上だけを確かめる。
	it("lets hf install and run on the Node.js the hook requires", () =>
		expect(read("packages/cli/package.json").engines).toEqual({
			node: ">=18",
		}));
});
