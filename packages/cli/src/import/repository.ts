import { isAbsolute } from "node:path";
import { normalizeRepository } from "@harnessforce/semconv";
import { createGitRunner, type RunGit } from "../process/git.js";
import type { Env } from "../process/lookup.js";

export type { RunGit };

// 1つのcwdへのgitの呼び出しの上限。応答しないfilesystemで取り込みを止めない。
const GIT_TIMEOUT_MS = 5000;

// correlation.md「commandの解決」: gitは現在のdirectoryとそのrepositoryの外から解決する。
export const createImportGit = (env: Env, processCwd: string): RunGit =>
	createGitRunner({
		platform: process.platform,
		env,
		processCwd,
		excludeTarget: false,
		timeoutMs: GIT_TIMEOUT_MS,
	});

// sessionのcwdのrepository（semantic-conventions.md「repositoryの正規化」）。remoteはhookと同じくoriginを優先する。
// repositoryの外、remoteの無いrepository、正規化できないremote、今は無いcwdはundefined（送らない）。
export async function resolveRepository(
	cwd: string,
	git: RunGit,
): Promise<string | undefined> {
	// 空のpathを`git -C`へ渡すと、現在のdirectoryが対象になる。
	if (!isAbsolute(cwd)) return undefined;
	if ((await git(cwd, ["rev-parse", "--is-inside-work-tree"])) !== "true")
		return undefined;
	const remotes = (await git(cwd, ["remote"]))?.split("\n") ?? [];
	const remote = remotes.includes("origin") ? "origin" : remotes[0];
	if (!remote) return undefined;
	const url = await git(cwd, ["remote", "get-url", remote]);
	return url === undefined ? undefined : normalizeRepository(url);
}
