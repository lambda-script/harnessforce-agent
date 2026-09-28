import { snapshotId } from "@harnessforce/agent-core/config/canonical";
import {
	COLLECT_BUDGET_MS,
	collectConfig,
} from "@harnessforce/agent-core/config/collect";
import type { RunGit } from "@harnessforce/agent-core/process/git";
import type { Env } from "@harnessforce/agent-core/types";
import { resolveProjectRoot, resolveVcs } from "@harnessforce/agent-core/vcs";

// 起動する前に分かる`hf.*`の値（correlation.md「CLI」の`hf run`）。
export type LaunchContext = {
	repository?: string;
	branch?: string;
	commit?: string;
	configVersion?: string;
};

export type LaunchContextOptions = {
	cwd: string;
	git: RunGit;
	homeDir: string;
	managedDir: string;
	env: Env;
	now: () => Date;
};

// correlation.md「CLI」の`hf run`の手順2。hookがsnapshotを送らない場合（0件、1秒超過、1,000件超過、識別子の重複）は注入しない。
async function resolveConfigVersion(
	options: LaunchContextOptions,
): Promise<string | undefined> {
	// 収集の開始はproject rootを求める前とする（correlation.md「構成の収集」）。
	const startedMs = options.now().getTime();
	const result = await collectConfig({
		projectRoot: await resolveProjectRoot(options.cwd, options.git),
		homeDir: options.homeDir,
		managedDir: options.managedDir,
		env: options.env,
		isExpired: () => options.now().getTime() - startedMs > COLLECT_BUDGET_MS,
	});
	if (result.kind === "skipped" || result.components.length === 0)
		return undefined;
	return snapshotId(result.components);
}

export async function resolveLaunchContext(
	options: LaunchContextOptions,
): Promise<LaunchContext> {
	const configVersion = await resolveConfigVersion(options);
	const vcs = await resolveVcs(options.cwd, options.git);
	return {
		...vcs,
		...(configVersion === undefined ? {} : { configVersion }),
	};
}
