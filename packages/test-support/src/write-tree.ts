import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// rootの下へ、相対pathと内容の組でfileを書く。途中のdirectoryも作る。
export function writeTree(root: string, files: Record<string, string>): void {
	for (const [path, content] of Object.entries(files)) {
		const file = join(root, path);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, content);
	}
}
