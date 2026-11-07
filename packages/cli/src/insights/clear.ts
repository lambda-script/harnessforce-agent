import { rm } from "node:fs/promises";
import type { InsightsPaths } from "./store.js";

// improvement-loop.md「端末のfile」: `~/.harnessforce/insights/`のfileと`proposals/`を削除する。
// config.json、import-state.json、keychainは削除しない。
export async function clearInsightsFiles(
	paths: InsightsPaths,
): Promise<boolean> {
	const targets = [
		paths.repositories,
		paths.analysis,
		paths.unsent,
		paths.sessionConfigs,
		paths.proposals,
		paths.proposalBodies,
	];
	const results = await Promise.allSettled(
		targets.map((path) => rm(path, { recursive: true, force: true })),
	);
	return results.every((r) => r.status === "fulfilled");
}
