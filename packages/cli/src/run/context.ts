import { isAbsolute } from "node:path";
import { normalizeRepository } from "@harnessforce/semconv";
import { snapshotId } from "../config/canonical.js";
import { COLLECT_BUDGET_MS, collectConfig } from "../config/collect.js";
import type { Env } from "../otel-headers.js";

// gitが失敗、または出力が空ならundefinedを返す。
export type RunGit = (
	cwd: string,
	args: readonly string[],
) => Promise<string | undefined>;

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

// pluginのhookと同じ求め方（correlation.md「repositoryとbranchの求め方」）。repositoryの外とremoteの無いrepositoryでは付けない。
async function resolveVcs(
	cwd: string,
	git: RunGit,
): Promise<Omit<LaunchContext, "configVersion">> {
	if ((await git(cwd, ["rev-parse", "--is-inside-work-tree"])) !== "true")
		return {};
	const remotes = (await git(cwd, ["remote"]))?.split("\n") ?? [];
	const remote = remotes.includes("origin") ? "origin" : remotes[0];
	if (!remote) return {};
	const [url, branch, commit] = await Promise.all([
		git(cwd, ["remote", "get-url", remote]),
		git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
		git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]),
	]);
	const repository = url === undefined ? undefined : normalizeRepository(url);
	return {
		...(repository === undefined ? {} : { repository }),
		...(branch === undefined ? {} : { branch }),
		...(commit === undefined ? {} : { commit }),
	};
}

// correlation.md「CLI」の`hf run`の手順2。hookがsnapshotを送らない場合（0件、1秒超過、1,000件超過、識別子の重複）は注入しない。
async function resolveConfigVersion(
	options: LaunchContextOptions,
): Promise<string | undefined> {
	// 収集の開始はproject rootを求める前とする（correlation.md「構成の収集」）。
	const startedMs = options.now().getTime();
	const topLevel = await options.git(options.cwd, [
		"rev-parse",
		"--show-toplevel",
	]);
	const result = await collectConfig({
		projectRoot: topLevel && isAbsolute(topLevel) ? topLevel : options.cwd,
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
