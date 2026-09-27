// package名ではなくsourceをbundleする。package entryはtypeboxのschemaごとbundleに入り、
// npm scopeを変える（scripts/set-npm-scope.mjs）とpackage名のimportが壊れるためである。
import { normalizeRepository } from "../../../packages/semconv/src/repository.js";

// gitが失敗、または出力が空ならundefinedを返す。
export type RunGit = (
	cwd: string,
	args: readonly string[],
) => Promise<string | undefined>;
export type Vcs = { repository?: string; branch?: string; commit?: string };

// correlation.md「repositoryとbranchの求め方」。repositoryの外とremoteの無いrepositoryはundefined（登録しない）。
export async function resolveVcs(
	cwd: string,
	git: RunGit,
): Promise<Vcs | undefined> {
	if ((await git(cwd, ["rev-parse", "--is-inside-work-tree"])) !== "true")
		return undefined;
	const remotes = (await git(cwd, ["remote"]))?.split("\n") ?? [];
	const remote = remotes.includes("origin") ? "origin" : remotes[0];
	if (!remote) return undefined;
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
