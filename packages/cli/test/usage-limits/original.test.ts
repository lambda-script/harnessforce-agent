import { describe, expect, it } from "vitest";
import { runOriginalCommand } from "../../src/usage-limits/original.js";

// 元のstatusLineのcommandは`sh -c`で起動する。Windowsではこの版は組み込まない。
describe.skipIf(process.platform === "win32")(
	"running the original statusLine command",
	() => {
		it("hands the stdin over unchanged", async () => {
			expect(
				await runOriginalCommand(
					'test "$(cat)" = \'{"a":1}\'',
					Buffer.from('{"a":1}'),
				),
			).toBe(0);
		});

		it("returns the exit code of the command", async () => {
			expect(await runOriginalCommand("exit 7", Buffer.alloc(0))).toBe(7);
		});

		it("returns 128 plus the signal number when a signal ends it", async () => {
			expect(await runOriginalCommand("kill -TERM $$", Buffer.alloc(0))).toBe(
				143,
			);
		});

		it("is not affected by a command that never reads stdin", async () => {
			expect(
				await runOriginalCommand("exit 0", Buffer.alloc(8 * 1024 * 1024)),
			).toBe(0);
		});

		it("waits for a slow command to finish", async () => {
			expect(await runOriginalCommand("sleep 1", Buffer.alloc(0))).toBe(0);
		});
	},
);
