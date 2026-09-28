import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { writeTree } from "@harnessforce/test-support/write-tree";
import { hashFileContent, hashValue } from "../../src/config/canonical.js";
import {
	type CollectOptions,
	collectConfig,
} from "../../src/config/collect.js";

export const fileHash = (content: string) =>
	hashFileContent(Buffer.from(content, "utf8"));
export { hashValue };

// project、home、managedを別々の一時directoryに置く。CLAUDE_CONFIG_DIRなどはenvで与える。
export function fixture(env: CollectOptions["env"] = {}) {
	const root = tempDir("hf-config-");
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
