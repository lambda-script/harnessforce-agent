import {
	chmodSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	importStatePath,
	readSentSessions,
	recordSentSessions,
} from "../../src/import/state.js";
import { tempDir } from "../config/support.js";

const A = { workspaceId: "ws-a", endpoint: "https://ingest.example.test/base" };
const B = { workspaceId: "ws-b", endpoint: "https://ingest.example.test/base" };
const STAGING = {
	workspaceId: "ws-a",
	endpoint: "https://ingest.staging.test",
};

describe("import state", () => {
	it("lives in ~/.harnessforce/import-state.json", () =>
		expect(importStatePath("/home/dev")).toBe(
			join("/home/dev", ".harnessforce", "import-state.json"),
		));

	it("has nothing sent before the first import", async () =>
		expect(
			await readSentSessions(join(tempDir("hf-state-"), "none.json"), A),
		).toEqual(new Set()));

	it("keeps sessions per workspace and ingest endpoint", async () => {
		const path = importStatePath(tempDir("hf-home-"));
		await recordSentSessions(path, A, ["s1", "s2"]);
		await recordSentSessions(path, A, ["s3", "s1"]);
		await recordSentSessions(path, B, ["s9"]);
		expect(await readSentSessions(path, A)).toEqual(
			new Set(["s1", "s2", "s3"]),
		);
		expect(await readSentSessions(path, B)).toEqual(new Set(["s9"]));
		expect(await readSentSessions(path, STAGING)).toEqual(new Set());
	});

	it("is readable only by the owner and written without leftovers", async () => {
		const home = tempDir("hf-home-");
		const path = importStatePath(home);
		await recordSentSessions(path, A, ["s1"]);
		expect(statSync(path).mode & 0o777).toBe(0o600);
		expect(statSync(join(home, ".harnessforce")).mode & 0o777).toBe(0o700);
		expect(readdirSync(join(home, ".harnessforce"))).toEqual([
			"import-state.json",
		]);
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
			version: 1,
			destinations: {
				"ws-a https://ingest.example.test/base": { sessions: ["s1"] },
			},
		});
	});

	it("restricts an existing directory to the owner", async () => {
		const home = tempDir("hf-home-");
		mkdirSync(join(home, ".harnessforce"), { mode: 0o755 });
		chmodSync(join(home, ".harnessforce"), 0o755);
		await recordSentSessions(importStatePath(home), A, ["s1"]);
		expect(statSync(join(home, ".harnessforce")).mode & 0o777).toBe(0o700);
	});

	it("treats a broken state file as nothing sent and replaces it", async () => {
		const path = join(tempDir("hf-state-"), "import-state.json");
		for (const content of [
			"{",
			"[]",
			'{"version":2}',
			'{"version":1,"destinations":{"ws-a https://ingest.example.test/base":{"sessions":[1]}}}',
		]) {
			writeFileSync(path, content);
			expect(await readSentSessions(path, A)).toEqual(new Set());
		}
		await recordSentSessions(path, A, ["s1"]);
		expect(await readSentSessions(path, A)).toEqual(new Set(["s1"]));
	});
});
