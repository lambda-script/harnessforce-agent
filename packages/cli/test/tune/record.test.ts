import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setupTune, writeFile } from "./harness.js";

const stdin = (value: unknown) => async () =>
	Buffer.from(
		typeof value === "string" ? value : JSON.stringify(value),
		"utf8",
	);

const skillProposal = (home: string, evidence: string[]) => ({
	category: "intervention.kind=continue",
	change_type: "skill",
	scope: "user",
	path: join(home, ".claude", "skills", "fix-ci", "SKILL.md"),
	component: { kind: "skill", source: "user", id: "fix-ci" },
	content: "a\r\nb",
	evidence_session_ids: evidence,
	body: "## 根拠\n...",
});

type Report = {
	session_id: string;
	proposals: Record<string, { shown: number; applied_detected: number }>;
};

describe("hf tune record", () => {
	it("records a proposal once, attributes it to the newest sendable evidence session and counts it in one report", async () => {
		const t = await setupTune();
		await t.run();
		const input = skillProposal(t.home.home, ["s001", "s003", "s002"]);
		const first = await t.run(["record"], { readStdin: stdin(input) });
		expect(first.code).toBe(0);
		const recorded = JSON.parse(first.out);
		expect(recorded).toMatchObject({
			created: true,
			attributed_session_id: "s003",
		});
		const second = await t.run(["record"], {
			readStdin: stdin({
				...input,
				body: "changed",
				evidence_session_ids: ["s009"],
			}),
		});
		expect(JSON.parse(second.out)).toEqual({ ...recorded, created: false });
		expect(
			readFileSync(
				join(t.tuneDir, "proposals", `${recorded.proposal_id}.md`),
				"utf8",
			),
		).toBe("changed");
		// 2回の実行で送っても、shownに数えるのは帰属先のsessionの分析結果だけである。
		await t.run();
		await t.run();
		for (const reports of t.reportBodies().slice(1) as unknown as Report[][]) {
			const shown = reports.filter((r) => r.proposals.skill?.shown === 1);
			expect(shown.map((r) => r.session_id)).toEqual(["s003"]);
		}
	});

	it("detects the applied skill by the content hash of the recorded proposal", async () => {
		const t = await setupTune();
		await t.run();
		const input = skillProposal(t.home.home, ["s000"]);
		await t.run(["record"], { readStdin: stdin(input) });
		const [record] = JSON.parse(
			readFileSync(join(t.tuneDir, "proposals.json"), "utf8"),
		).proposals;
		expect(record.expected_hash).toBe(
			createHash("sha256").update("a\nb").digest("hex"),
		);
		writeFile(input.path, "a\nb");
		await t.run();
		const reports = t.reportBodies().at(-1) as unknown as Report[];
		expect(
			reports.find((r) => r.session_id === "s000")?.proposals.skill,
		).toEqual({
			shown: 1,
			applied_detected: 1,
		});
	});

	it.each([
		["JSON that is not an object", "[]", "input"],
		["broken JSON", "{", "input"],
		["an unknown category", { category: "x" }, "category"],
	])("rejects %s", async (_, value, field) => {
		const t = await setupTune({ sessions: 1 });
		await t.run();
		expect(await t.run(["record"], { readStdin: stdin(value) })).toEqual({
			code: 2,
			out: "",
			err: `提案の記録の入力が不正です: ${field}\n`,
		});
	});

	it("rejects evidence sessions that are not in analysis.json and input over 1 MiB", async () => {
		const t = await setupTune({ sessions: 1 });
		await t.run();
		const input = skillProposal(t.home.home, ["nope"]);
		expect((await t.run(["record"], { readStdin: stdin(input) })).err).toBe(
			"提案の記録の入力が不正です: evidence_session_ids\n",
		);
		expect(
			(
				await t.run(["record"], {
					readStdin: async () => Buffer.alloc(1024 * 1024 + 1, 32),
				})
			).code,
		).toBe(2);
		expect(existsSync(join(t.tuneDir, "proposals.json"))).toBe(true);
		expect(
			JSON.parse(readFileSync(join(t.tuneDir, "proposals.json"), "utf8"))
				.proposals,
		).toEqual([]);
	});

	it("does not use the network or the keychain", async () => {
		const t = await setupTune({ sessions: 1 });
		await t.run();
		const before = t.hf.requests.length;
		const { untouchableKeychain } = await import("../support/cli.js");
		const result = await t.run(["record"], {
			keychain: untouchableKeychain,
			readStdin: stdin(skillProposal(t.home.home, ["s000"])),
		});
		expect(result.code).toBe(0);
		expect(t.hf.requests.length).toBe(before);
	});
});

describe("hf tune --purge", () => {
	it("deletes the tune files but keeps the terminal setting and the import state", async () => {
		const t = await setupTune({ sessions: 1 });
		await t.run();
		writeFile(join(t.home.home, ".harnessforce", "config.json"), "{}");
		const result = await t.run(["--purge"]);
		expect(result).toEqual({
			code: 0,
			out: "",
			err: "`~/.harnessforce/tune/`の分析結果、提案、未送信の分析結果を削除しました\n",
		});
		for (const name of [
			"analysis.json",
			"repositories.json",
			"proposals.json",
			"session-configs.json",
		])
			expect(existsSync(join(t.tuneDir, name))).toBe(false);
		expect(existsSync(join(t.home.home, ".harnessforce", "config.json"))).toBe(
			true,
		);
		expect(
			existsSync(join(t.home.home, ".harnessforce", "import-state.json")),
		).toBe(true);
	});

	it("does not run while another hf tune holds the lock", async () => {
		const t = await setupTune({ sessions: 1 });
		writeFile(join(t.tuneDir, ".lock"), "");
		let nowMs = Date.now();
		const result = await t.run(["--purge"], {
			now: () => new Date(nowMs),
			sleep: async (ms) => {
				nowMs += ms;
			},
		});
		expect(result).toEqual({
			code: 1,
			out: "",
			err: "別の`hf tune`が実行中のため、実行できません\n",
		});
	});
});
