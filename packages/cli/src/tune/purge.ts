import { rm } from "node:fs/promises";
import type { TunePaths } from "./store.js";

// improvement-loop.md「端末のfile」: `~/.harnessforce/tune/`のfileと`proposals/`を削除する。
// config.json、import-state.json、keychainは削除しない。
export async function purgeTuneFiles(paths: TunePaths): Promise<boolean> {
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
