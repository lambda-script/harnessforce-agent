import { isAbsolute } from "node:path";
import { normalizeRepository } from "@harnessforce/semconv";
import type { RunGit } from "./process/git.js";

export type Vcs = { repository?: string; branch?: string; commit?: string };

// correlation.md「repositoryとbranchの求め方」: remoteはoriginを優先し、無ければ最初のremote。
// repositoryの外とremoteの無いrepositoryはundefined。
async function selectRemote(
	cwd: string,
	git: RunGit,
): Promise<string | undefined> {
	if ((await git(cwd, ["rev-parse", "--is-inside-work-tree"])) !== "true")
		return undefined;
	const remotes = (await git(cwd, ["remote"]))?.split("\n") ?? [];
	return remotes.includes("origin") ? "origin" : remotes[0];
}

// hookのsession registrationとharnessforce runの`hf.*`の値。repositoryの外とremoteの無いrepositoryはundefined（付けない）。
export async function resolveVcs(
	cwd: string,
	git: RunGit,
): Promise<Vcs | undefined> {
	const remote = await selectRemote(cwd, git);
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

// session importのsessionのcwdのrepository（semantic-conventions.md「repositoryの正規化」）。
// repositoryの外、remoteの無いrepository、正規化できないremote、今は無いcwdはundefined（送らない）。
export async function resolveRepository(
	cwd: string,
	git: RunGit,
): Promise<string | undefined> {
	// 空のpathを`git -C`へ渡すと、現在のdirectoryが対象になる。
	if (!isAbsolute(cwd)) return undefined;
	const remote = await selectRemote(cwd, git);
	if (!remote) return undefined;
	const url = await git(cwd, ["remote", "get-url", remote]);
	return url === undefined ? undefined : normalizeRepository(url);
}

// correlation.md「構成の収集」: project rootはrepositoryのroot。repositoryの外やgitの失敗ではcwd。
export async function resolveProjectRoot(
	cwd: string,
	git: RunGit,
): Promise<string> {
	const topLevel = await git(cwd, ["rev-parse", "--show-toplevel"]);
	return topLevel && isAbsolute(topLevel) ? topLevel : cwd;
}
