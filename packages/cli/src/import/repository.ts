import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { normalizeRepository } from "@harnessforce/semconv";

// gitが失敗、または出力が空ならundefinedを返す。
export type RunGit = (
	cwd: string,
	args: readonly string[],
) => Promise<string | undefined>;

// 1つのcwdへのgitの呼び出しの上限。応答しないfilesystemで取り込みを止めない。
const GIT_TIMEOUT_MS = 5000;

export const runGit: RunGit = (cwd, args) =>
	new Promise((resolve) => {
		// GIT_DIRなどが環境にあると、cwdではなくそのrepositoryを読むため、gitへは渡さない。
		const env = Object.fromEntries(
			Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
		);
		execFile(
			"git",
			["-C", cwd, ...args],
			{ encoding: "utf8", env, timeout: GIT_TIMEOUT_MS, windowsHide: true },
			(error, stdout) =>
				resolve(error ? undefined : stdout.trim() || undefined),
		);
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
