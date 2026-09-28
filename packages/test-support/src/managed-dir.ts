import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./temp-dir.js";

// managed settingsのdirectory。managed-settings.jsonとmanaged-settings.d/のfileを書く。
export function managedDir(
	settings: Record<string, unknown> | null,
	dropIns: Record<string, string> = {},
): string {
	const dir = tempDir("hf-managed-");
	if (settings)
		writeFileSync(join(dir, "managed-settings.json"), JSON.stringify(settings));
	if (Object.keys(dropIns).length > 0) {
		mkdirSync(join(dir, "managed-settings.d"));
		for (const [name, content] of Object.entries(dropIns))
			writeFileSync(join(dir, "managed-settings.d", name), content);
	}
	return dir;
}
