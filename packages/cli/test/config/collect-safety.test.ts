import { execFileSync } from "node:child_process";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectConfig } from "../../src/config/collect.js";
import { components, fileHash, fixture, writeTree } from "./support.js";

const MIB = 1024 * 1024;

describe("collection safety", () => {
	it("does not read devices or FIFOs that a repository symlinks to", async () => {
		const f = fixture();
		mkdirSync(join(f.options.projectRoot, ".claude/rules"), {
			recursive: true,
		});
		symlinkSync("/dev/zero", join(f.options.projectRoot, "CLAUDE.md"));
		const fifo = join(f.root, "pipe");
		execFileSync("mkfifo", [fifo]);
		symlinkSync(fifo, join(f.options.projectRoot, ".claude/rules/pipe.md"));
		f.project({ ".claude/rules/ok.md": "ok" });
		expect(await components(f.options)).toEqual([
			{
				kind: "rule",
				source: "repository",
				id: "rules/ok.md",
				hash: fileHash("ok"),
			},
		]);
	});

	it("skips files larger than 1 MiB", async () => {
		const f = fixture();
		f.project({
			"CLAUDE.md": "x".repeat(MIB + 1),
			".claude/rules/limit.md": "y".repeat(MIB),
		});
		expect((await components(f.options)).map((c) => c.id)).toEqual([
			"rules/limit.md",
		]);
	});

	it.each([
		"x@../../../outside",
		"../../outside@m",
		"x@.",
		"..@m",
		"x@a/b",
	])("does not resolve the plugin id %s outside the plugins root", async (id) => {
		const f = fixture();
		f.project({
			".claude/settings.json": JSON.stringify({
				enabledPlugins: { [id]: true },
			}),
		});
		// idがそのままpathに連結されたときに届く場所へ、集められうるfileを置く。
		writeTree(f.options.homeDir, {
			"outside/x/1.0.0/commands/leak.md": "leak",
			".claude/plugins/outside/1.0.0/commands/leak.md": "leak",
			".claude/plugins/cache/x/1.0.0/commands/leak.md": "leak",
		});
		writeTree(f.options.homeDir, {
			".claude/plugins/cache/m/x/1.0.0/commands/c.md": "c",
		});
		expect(await components(f.options)).toEqual([]);
	});

	it("treats an unreadable .orphaned_at as present", async () => {
		const f = fixture();
		f.home({
			".claude/settings.json": JSON.stringify({
				enabledPlugins: { "p@m": true },
			}),
		});
		writeTree(f.options.homeDir, {
			".claude/plugins/cache/m/p/1.0.0/commands/old.md": "old",
			".claude/plugins/cache/m/p/2.0.0/commands/new.md": "new",
		});
		mkdirSync(
			join(f.options.homeDir, ".claude/plugins/cache/m/p/1.0.0/.orphaned_at"),
		);
		expect((await components(f.options)).map((c) => c.id)).toEqual(["p@m:new"]);
	});

	// Windowsのfile名は`:`を含めず、`a:b.md`と`a/b.md`の衝突を作れない。
	it.skipIf(process.platform === "win32")(
		"skips the snapshot when two files map to the same identifier",
		async () => {
			const f = fixture();
			f.project({
				".claude/agents/a/b.md": "nested",
				".claude/agents/a:b.md": "flat",
				".claude/agents/c.md": "c",
			});
			expect(await collectConfig(f.options)).toEqual({
				kind: "skipped",
				reason: "duplicate identifier",
			});
		},
	);

	it("walks a directory reached again through a symlink cycle only once", async () => {
		const f = fixture();
		f.project({ ".claude/agents/team/lead.md": "lead" });
		const team = join(f.options.projectRoot, ".claude/agents/team");
		for (const name of ["loop1", "loop2", "loop3"])
			symlinkSync(team, join(team, name));
		expect((await components(f.options)).map((c) => c.id)).toEqual([
			"team:lead",
		]);
	});

	it("reports a timeout when the deadline passes during the last read", async () => {
		const f = fixture();
		f.project({ "CLAUDE.md": "a" });
		let expired = false;
		const result = await collectConfig({
			...f.options,
			isExpired: () => {
				const was = expired;
				expired = true;
				return was;
			},
		});
		expect(result).toEqual({ kind: "skipped", reason: "timeout" });
	});
});
