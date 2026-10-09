import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { describe, expect, it } from "vitest";
import { readTuneSessions } from "../../src/tune/sessions.js";

// improvement-loop.md「端末だけの値」: sessionごとの圧縮、応答、cacheの再利用、modelの使い分け。
const SESSION = "4b1c2d3e-0000-4000-8000-0000000000aa";
const T0 = Date.parse("2026-09-20T01:00:00Z");
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();
const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const base = { sessionId: SESSION, cwd: "/work/web" };

const prompt = (seconds: number) =>
	line({
		...base,
		type: "user",
		timestamp: at(seconds),
		message: { role: "user", content: "fix it" },
	});

type Usage = Record<string, number>;
const usage = (input: number, output: number, read = 0, creation = 0) => ({
	input_tokens: input,
	output_tokens: output,
	cache_read_input_tokens: read,
	cache_creation_input_tokens: creation,
});

// 1つの応答をcontent blockごとに`rows`個の記録に分け、同じ`message.id`と`usage`を書く（claude-code.md）。
const response = (
	id: string,
	model: string,
	seconds: number,
	responseUsage: Usage | undefined,
	rows = 1,
	extra: Record<string, unknown> = {},
) =>
	Array.from({ length: rows }, (_, i) =>
		line({
			...base,
			...extra,
			type: "assistant",
			timestamp: at(seconds + i),
			message: {
				id,
				model,
				content: [{ type: "text", text: `block ${i}` }],
				...(responseUsage ? { usage: responseUsage } : {}),
			},
		}),
	).join("");

const compaction = (seconds: number, trigger: string) =>
	line({
		...base,
		type: "system",
		subtype: "compact_boundary",
		timestamp: at(seconds),
		compactMetadata: { trigger, preTokens: 150000, postTokens: 9000 },
	});

function projects(main: string, subagents: Record<string, string> = {}) {
	const projectsDir = tempDir("hf-usage-");
	const dir = join(projectsDir, "-work-web");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${SESSION}.jsonl`), main);
	if (Object.keys(subagents).length > 0) {
		const subagentDir = join(dir, SESSION, "subagents");
		mkdirSync(subagentDir, { recursive: true });
		for (const [name, content] of Object.entries(subagents))
			writeFileSync(join(subagentDir, name), content);
	}
	return { projectsDir, dir };
}

async function usageOf(projectsDir: string) {
	const [session] = await readTuneSessions({
		projectsDir,
		modifiedSinceMs: undefined,
		git: async () => undefined,
	});
	return session?.usage;
}

describe("usage of a session (terminal-only values)", () => {
	it("counts auto and manual compactions from compact_boundary records of the main transcript", async () => {
		const { projectsDir } = projects(
			prompt(0) +
				response("m1", "claude-opus-5-5", 1, usage(1, 1)) +
				compaction(10, "auto") +
				compaction(20, "manual") +
				compaction(30, "auto"),
		);
		expect(await usageOf(projectsDir)).toMatchObject({
			compactions_auto: 2,
			compactions_manual: 1,
			kinds: ["frequent_compaction"],
		});
	});

	// 受入条件: 同じmessage.idの3つの記録のusageは1回だけ足され、19応答のsessionはlow_cache_reuseに当たらない。
	it("counts a response once per message.id and adds its usage once", async () => {
		const rows = Array.from({ length: 19 }, (_, i) =>
			response(`m${i}`, "claude-opus-5-5", i * 10, usage(9, 2, 1, 0), 3),
		).join("");
		const { projectsDir } = projects(prompt(0) + rows);
		expect(await usageOf(projectsDir)).toMatchObject({
			responses: 19,
			cache_reuse_ratio: 0.1,
			models: [{ model: "claude-opus-5-5", responses: 19, output_tokens: 38 }],
			kinds: [],
		});
	});

	it("marks a session with 20 responses and less than half cache reuse as low_cache_reuse", async () => {
		const rows = Array.from({ length: 20 }, (_, i) =>
			response(`m${i}`, "claude-opus-5-5", i * 10, usage(5, 1, 4, 1), 2),
		).join("");
		const { projectsDir } = projects(prompt(0) + rows);
		expect(await usageOf(projectsDir)).toMatchObject({
			responses: 20,
			cache_reuse_ratio: 0.4,
			kinds: ["low_cache_reuse"],
		});
	});

	it("leaves out <synthetic> responses and responses without usage", async () => {
		const { projectsDir } = projects(
			prompt(0) +
				response("m1", "claude-opus-5-5", 1, usage(1, 5, 3, 0)) +
				response("m2", "<synthetic>", 2, usage(100, 100, 0, 0)) +
				response("m3", "claude-opus-5-5", 3, undefined),
		);
		expect(await usageOf(projectsDir)).toMatchObject({
			responses: 1,
			cache_reuse_ratio: 0.75,
			models: [{ model: "claude-opus-5-5", responses: 1, output_tokens: 5 }],
		});
	});

	it("gives a null cache reuse ratio, not 0, when there is no input token", async () => {
		const { projectsDir } = projects(
			prompt(0) + response("m1", "claude-opus-5-5", 1, usage(0, 1, 0, 0)),
		);
		expect(await usageOf(projectsDir)).toMatchObject({
			responses: 1,
			cache_reuse_ratio: null,
		});
	});

	it("reads subagent models from <session>/subagents/*.jsonl and keeps them out of the main values", async () => {
		const sidechain = { isSidechain: true };
		const { projectsDir } = projects(
			prompt(0) + response("m1", "claude-opus-5-5", 1, usage(1, 10, 1, 0)),
			{
				"agent-a.jsonl": response(
					"a1",
					"claude-haiku-4-5",
					5,
					usage(1, 7),
					2,
					sidechain,
				),
				"agent-b.jsonl":
					response("b1", "claude-haiku-4-5", 6, usage(1, 3), 1, sidechain) +
					response("b2", "claude-sonnet-5", 7, usage(1, 4), 1, sidechain) +
					response("b3", "<synthetic>", 8, usage(1, 50), 1, sidechain),
			},
		);
		expect(await usageOf(projectsDir)).toMatchObject({
			responses: 1,
			models: [{ model: "claude-opus-5-5", responses: 1, output_tokens: 10 }],
			subagent_models: [
				{ model: "claude-haiku-4-5", responses: 2, output_tokens: 10 },
				{ model: "claude-sonnet-5", responses: 1, output_tokens: 4 },
			],
		});
	});

	const main =
		prompt(0) + response("m1", "claude-opus-5-5", 1, usage(1, 1, 0, 0));

	it("gives empty subagent models without subagents", async () =>
		expect(
			(await usageOf(projects(main).projectsDir))?.subagent_models,
		).toEqual([]));

	// WindowsはPOSIXのpermission bitを持たず、chmodでfileを読めなくできない。
	it.skipIf(process.platform === "win32")(
		"gives null subagent models when a subagent transcript cannot be read",
		async () => {
			const { projectsDir, dir } = projects(main, {
				"agent-a.jsonl": response("a1", "claude-haiku-4-5", 5, usage(1, 7)),
			});
			chmodSync(join(dir, SESSION, "subagents", "agent-a.jsonl"), 0o000);
			expect((await usageOf(projectsDir))?.subagent_models).toBeNull();
		},
	);
});
