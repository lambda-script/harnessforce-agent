import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	components,
	fileHash,
	fixture,
	tempDir,
	writeTree,
} from "./support.js";

describe("file-based components", () => {
	it("collects rules from every scope with scope-relative identifiers", async () => {
		const f = fixture();
		f.managed({ "CLAUDE.md": "managed" });
		f.home({
			".claude/CLAUDE.md": "user",
			".claude/rules/style.md": "style",
			".claude/rules/web/react.md": "react",
		});
		f.project({
			"CLAUDE.md": "root",
			".claude/CLAUDE.md": "dot",
			".claude/rules/testing.md": "testing",
			"CLAUDE.local.md": "local",
		});
		expect(await components(f.options)).toEqual([
			{
				kind: "rule",
				source: "local",
				id: "CLAUDE.local.md",
				hash: fileHash("local"),
			},
			{
				kind: "rule",
				source: "managed",
				id: "CLAUDE.md",
				hash: fileHash("managed"),
			},
			{
				kind: "rule",
				source: "repository",
				id: ".claude/CLAUDE.md",
				hash: fileHash("dot"),
			},
			{
				kind: "rule",
				source: "repository",
				id: "CLAUDE.md",
				hash: fileHash("root"),
			},
			{
				kind: "rule",
				source: "repository",
				id: "rules/testing.md",
				hash: fileHash("testing"),
			},
			{ kind: "rule", source: "user", id: "CLAUDE.md", hash: fileHash("user") },
			{
				kind: "rule",
				source: "user",
				id: "rules/style.md",
				hash: fileHash("style"),
			},
			{
				kind: "rule",
				source: "user",
				id: "rules/web/react.md",
				hash: fileHash("react"),
			},
		]);
	});

	it("collects skills by directory name, hashing SKILL.md only", async () => {
		const f = fixture();
		f.managed({ ".claude/skills/audit/SKILL.md": "audit" });
		f.home({ ".claude/skills/deploy/SKILL.md": "deploy" });
		f.project({
			".claude/skills/review/SKILL.md": "review",
			".claude/skills/review/notes.md": "not hashed",
			".claude/skills/empty/README.md": "no SKILL.md",
		});
		expect(await components(f.options)).toEqual([
			{
				kind: "skill",
				source: "managed",
				id: "audit",
				hash: fileHash("audit"),
			},
			{
				kind: "skill",
				source: "repository",
				id: "review",
				hash: fileHash("review"),
			},
			{ kind: "skill", source: "user", id: "deploy", hash: fileHash("deploy") },
		]);
	});

	it("names agents and commands by their relative path with / replaced by :", async () => {
		const f = fixture();
		f.home({ ".claude/agents/review/security.md": "sec" });
		f.project({
			".claude/agents/planner.md": "plan",
			".claude/commands/frontend/component.md": "cmd",
			".claude/commands/notes.txt": "ignored",
		});
		expect(await components(f.options)).toEqual([
			{
				kind: "agent",
				source: "repository",
				id: "planner",
				hash: fileHash("plan"),
			},
			{
				kind: "agent",
				source: "user",
				id: "review:security",
				hash: fileHash("sec"),
			},
			{
				kind: "command",
				source: "repository",
				id: "frontend:component",
				hash: fileHash("cmd"),
			},
		]);
	});

	it("collects only top-level .js workflows", async () => {
		const f = fixture();
		f.project({
			".claude/workflows/audit-routes.js": "wf",
			".claude/workflows/nested/skip.js": "nested",
		});
		expect(await components(f.options)).toEqual([
			{
				kind: "workflow",
				source: "repository",
				id: "audit-routes",
				hash: fileHash("wf"),
			},
		]);
	});

	it("reads user workflows from CLAUDE_CONFIG_DIR and skips user files whose location it does not document", async () => {
		const configDir = tempDir("hf-config-dir-");
		writeTree(configDir, {
			"workflows/triage.js": "wf",
			"rules/a.md": "a",
			"CLAUDE.md": "c",
		});
		const f = fixture({ CLAUDE_CONFIG_DIR: configDir });
		f.home({ ".claude/rules/b.md": "b", ".claude/workflows/old.js": "old" });
		expect(await components(f.options)).toEqual([
			{ kind: "workflow", source: "user", id: "triage", hash: fileHash("wf") },
		]);
	});

	it("ignores a relative CLAUDE_CONFIG_DIR", async () => {
		const f = fixture({ CLAUDE_CONFIG_DIR: "relative/dir" });
		f.home({ ".claude/rules/b.md": "b" });
		expect((await components(f.options)).map((c) => c.id)).toEqual([
			"rules/b.md",
		]);
	});

	it("skips hidden entries, identifiers with whitespace, and recursion deeper than 8 levels", async () => {
		const f = fixture();
		const deep = Array.from({ length: 9 }, (_, i) => `d${i}`).join("/");
		const shallow = Array.from({ length: 8 }, (_, i) => `d${i}`).join("/");
		f.project({
			".claude/rules/.draft.md": "hidden",
			".claude/rules/.git/x.md": "hidden dir",
			".claude/rules/my rule.md": "space",
			[`.claude/rules/${shallow}/ok.md`]: "ok",
			[`.claude/rules/${deep}/too-deep.md`]: "deep",
		});
		expect((await components(f.options)).map((c) => c.id)).toEqual([
			`rules/${shallow}/ok.md`,
		]);
	});

	it("follows symlinked rule directories", async () => {
		const shared = tempDir("hf-shared-");
		writeTree(shared, { "security.md": "sec" });
		const f = fixture();
		mkdirSync(join(f.options.projectRoot, ".claude/rules"), {
			recursive: true,
		});
		symlinkSync(shared, join(f.options.projectRoot, ".claude/rules/shared"));
		expect(await components(f.options)).toEqual([
			{
				kind: "rule",
				source: "repository",
				id: "rules/shared/security.md",
				hash: fileHash("sec"),
			},
		]);
	});

	it("returns no components for an empty configuration", async () =>
		expect(await components(fixture().options)).toEqual([]));
});
