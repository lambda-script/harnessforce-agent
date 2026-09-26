import { createHash } from "node:crypto";
import type { ConfigComponent } from "./component.js";

// correlation.md「構成の収集」とsemantic-conventions.md「Config snapshot」の正規化。
// JSの既定の比較（UTF-16のcode unitの順）で並べ、hookとhf runで同じ結果にする。
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (typeof value === "object" && value !== null) {
		const entries = Object.keys(value)
			.sort(byCodeUnit)
			.map(
				(key) =>
					`${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
			);
		return `{${entries.join(",")}}`;
	}
	return JSON.stringify(value);
}

const sha256 = (data: string | Buffer) =>
	createHash("sha256").update(data).digest("hex");

export const hashValue = (value: unknown) =>
	sha256(Buffer.from(canonicalJson(value), "utf8"));

// 改行の違い（autocrlf）で同じ定義のhashが変わらないよう、CRLFをLFにしてからhashする。
export function hashFileContent(content: Buffer): string {
	const normalized = content.includes("\r\n")
		? Buffer.from(content.toString("latin1").replace(/\r\n/g, "\n"), "latin1")
		: content;
	return sha256(normalized);
}

export function sortComponents(
	components: readonly ConfigComponent[],
): ConfigComponent[] {
	return [...components].sort(
		(a, b) =>
			byCodeUnit(a.kind, b.kind) ||
			byCodeUnit(a.source, b.source) ||
			byCodeUnit(a.id, b.id),
	);
}

export const snapshotId = (components: readonly ConfigComponent[]) =>
	hashValue(sortComponents(components));
