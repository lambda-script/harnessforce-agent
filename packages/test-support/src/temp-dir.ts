import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";

// testの終了時に削除する一時directory。testの中でだけ呼ぶ。
export function tempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}
