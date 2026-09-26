import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { onTestFinished } from "vitest";
import { hashFileContent, hashValue } from "../../src/config/canonical.js";
import {
	type CollectOptions,
	collectConfig,
} from "../../src/config/collect.js";

// testの終了時に削除する一時directory。testの中でだけ呼ぶ。
export function tempDir(prefix = "hf-config-"): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

export function writeTree(root: string, files: Record<string, string>): void {
	for (const [path, content] of Object.entries(files)) {
		const file = join(root, path);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, content);
	}
}

export const fileHash = (content: string) =>
	hashFileContent(Buffer.from(content, "utf8"));
export { hashValue };

// project、home、managedを別々の一時directoryに置く。CLAUDE_CONFIG_DIRなどはenvで与える。
export function fixture(env: CollectOptions["env"] = {}) {
	const root = tempDir();
	const options: CollectOptions = {
		projectRoot: join(root, "project"),
		homeDir: join(root, "home"),
		managedDir: join(root, "managed"),
		env,
		isExpired: () => false,
	};
	for (const dir of [options.projectRoot, options.homeDir, options.managedDir])
		mkdirSync(dir, { recursive: true });
	return {
		root,
		options,
		project: (files: Record<string, string>) =>
			writeTree(options.projectRoot, files),
		home: (files: Record<string, string>) => writeTree(options.homeDir, files),
		managed: (files: Record<string, string>) =>
			writeTree(options.managedDir, files),
	};
}

export async function components(options: CollectOptions) {
	const result = await collectConfig(options);
	if (result.kind !== "collected") throw new Error(result.reason);
	return result.components;
}
