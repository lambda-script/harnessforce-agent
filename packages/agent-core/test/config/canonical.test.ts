import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	canonicalJson,
	hashFileContent,
	hashValue,
	snapshotId,
	sortComponents,
} from "../../src/config/canonical.js";
import type { ConfigComponent } from "../../src/config/component.js";

const sha256 = (text: string) =>
	createHash("sha256").update(text, "utf8").digest("hex");

describe("canonicalJson", () => {
	it("sorts object keys recursively and drops whitespace", () =>
		expect(
			canonicalJson({ b: [{ z: 1, a: "x" }], a: { d: null, c: true } }),
		).toBe('{"a":{"c":true,"d":null},"b":[{"a":"x","z":1}]}'));

	it("orders keys by UTF-16 code units", () =>
		expect(canonicalJson({ b: 1, B: 2, é: 3, a: 4 })).toBe(
			'{"B":2,"a":4,"b":1,"é":3}',
		));
});

describe("hashes", () => {
	it("hashes values as canonical JSON", () =>
		expect(hashValue({ allow: ["Bash"], deny: [] })).toBe(
			sha256('{"allow":["Bash"],"deny":[]}'),
		));

	it("hashes file content with CRLF normalized to LF", () => {
		const lf = hashFileContent(Buffer.from("# rule\nline\n"));
		expect(hashFileContent(Buffer.from("# rule\r\nline\r\n"))).toBe(lf);
		expect(lf).toBe(sha256("# rule\nline\n"));
	});
});

const component = (
	kind: ConfigComponent["kind"],
	source: ConfigComponent["source"],
	id: string,
): ConfigComponent => ({ kind, source, id, hash: "a".repeat(64) });

describe("snapshot identity", () => {
	it("orders components by kind, source and identifier", () =>
		expect(
			sortComponents([
				component("skill", "user", "b"),
				component("rule", "user", "x"),
				component("skill", "repository", "z"),
				component("skill", "user", "a"),
			]).map((c) => `${c.kind}/${c.source}/${c.id}`),
		).toEqual([
			"rule/user/x",
			"skill/repository/z",
			"skill/user/a",
			"skill/user/b",
		]));

	it("derives the ID from the sorted canonical components", () => {
		const components = [
			component("skill", "user", "b"),
			{ ...component("rule", "plugin", "p:x"), version: "1.0.0" },
		];
		expect(snapshotId(components)).toBe(
			sha256(
				canonicalJson([
					{ ...component("rule", "plugin", "p:x"), version: "1.0.0" },
					component("skill", "user", "b"),
				]),
			),
		);
		expect(snapshotId([...components].reverse())).toBe(snapshotId(components));
	});
});
