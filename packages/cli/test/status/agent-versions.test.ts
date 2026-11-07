import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentVersionReader } from "../../src/status/agent-versions.js";

// 実際に子プロセスを起動する。shell scriptで代えるためPOSIXだけで確かめる。
describe.skipIf(process.platform === "win32")("agent version reader", () => {
	function machine(scripts: Record<string, string>) {
		const root = mkdtempSync(join(tmpdir(), "hf-agent-versions-"));
		const bin = join(root, "bin");
		const cwd = join(root, "work");
		mkdirSync(bin);
		mkdirSync(cwd);
		for (const [name, body] of Object.entries(scripts)) {
			const file = join(bin, name);
			writeFileSync(file, `#!/bin/sh\n${body}\n`);
			chmodSync(file, 0o755);
		}
		return { bin, cwd };
	}

	it("returns the stdout of <command> --version", async () => {
		const { bin, cwd } = machine({
			claude: 'test "$1" = --version && echo "2.1.100 (Claude Code)"',
		});
		const read = createAgentVersionReader({
			platform: process.platform,
			env: { PATH: bin },
			cwd,
		});
		expect(await read("claude")).toBe("2.1.100 (Claude Code)\n");
	});

	it.each([
		["the command is not on PATH", {}],
		["the command exits non-zero", { codex: "echo 0.1.0; exit 3" }],
		["the command takes longer than the limit", { codex: "sleep 2" }],
	])("returns undefined when %s", async (_, scripts) => {
		const { bin, cwd } = machine(scripts);
		const read = createAgentVersionReader({
			platform: process.platform,
			env: { PATH: bin },
			cwd,
			timeoutMs: 200,
		});
		expect(await read("codex")).toBeUndefined();
	});

	// correlation.md「commandの解決」: 作業しているdirectoryは探さない。
	it("does not run a command placed in the working directory", async () => {
		const { cwd } = machine({});
		const planted = join(cwd, "claude");
		writeFileSync(planted, "#!/bin/sh\necho 2.1.1\n");
		chmodSync(planted, 0o755);
		const read = createAgentVersionReader({
			platform: process.platform,
			env: { PATH: cwd },
			cwd,
		});
		expect(await read("claude")).toBeUndefined();
	});
});
