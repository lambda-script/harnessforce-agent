import { readFileSync } from "node:fs";
import { CODEX_HOOKS } from "@harnessforce/agent-core/codex-hooks";
import { usingHarnessforceBody } from "@harnessforce/agent-core/using-harnessforce";
import { describe, expect, it } from "vitest";

// turboはtestの前にこのpackageのbuildを実行する。直接vitestを実行する場合は先に`pnpm build`する。
const builtHooks = new URL(
	"../dist/marketplace/plugins/harnessforce/hooks/hooks.json",
	import.meta.url,
);

// 「What is sent, and when」の表の1列目。1つのcellが「, 」で区切った複数のhookを持つ。
function documentedHooks(body: string): string[] {
	const section = /^## What is sent, and when\n([\s\S]*?)(?=^## )/m.exec(
		body,
	)?.[1];
	if (!section) throw new Error('no "What is sent, and when" section');
	return section
		.split("\n")
		.filter((line) => line.startsWith("| ") && !/^\| (Hook|---) /.test(line))
		.flatMap((line) => (line.split(" | ")[0] ?? "").slice(2).split(", "));
}

function countsOf(events: string[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const event of events) counts[event] = (counts[event] ?? 0) + 1;
	return counts;
}

describe("using-harnessforce hook table", () => {
	// correlation.md「using-harnessforce」: 利用者に開示する送信の表は、両agentに配線したhookと一致する。
	// hookごとの行数は、両agentのうちそのhookのgroupが多い方の数とする（PostToolUseは数えるgroupと作業位置のgroupを持つ）。
	// hookを足すか除いたら、本文の表も直さないとここで落ちる。
	it("has a row for every hook group the plugin and Codex wire", () => {
		const { hooks } = JSON.parse(readFileSync(builtHooks, "utf8")) as {
			hooks: Record<string, unknown[]>;
		};
		const claude = countsOf(
			Object.entries(hooks).flatMap(([event, groups]) =>
				groups.map(() => event),
			),
		);
		const codex = countsOf(CODEX_HOOKS.map((spec) => spec.event));
		const events = new Set([...Object.keys(claude), ...Object.keys(codex)]);
		const expected = Object.fromEntries(
			[...events].map((event) => [
				event,
				Math.max(claude[event] ?? 0, codex[event] ?? 0),
			]),
		);
		expect(countsOf(documentedHooks(usingHarnessforceBody))).toEqual(expected);
	});

	it("reads every hook of a row", () => {
		const body = [
			"## What is sent, and when",
			"",
			"| Hook | What it does |",
			"| --- | --- |",
			"| A | x |",
			"| B, C | y, z |",
			"",
			"## Next",
		].join("\n");
		expect(documentedHooks(body)).toEqual(["A", "B", "C"]);
	});
});
