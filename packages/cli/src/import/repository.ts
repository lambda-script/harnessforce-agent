import {
	createGitRunner,
	type RunGit,
} from "@harnessforce/agent-core/process/git";
import type { Env } from "@harnessforce/agent-core/types";

// 1つのcwdへのgitの呼び出しの上限。応答しないfilesystemで取り込みを止めない。
const GIT_TIMEOUT_MS = 5000;

// correlation.md「commandの解決」: gitは現在のdirectoryとそのrepositoryの外から解決する。
export const createImportGit = (
	platform: NodeJS.Platform,
	env: Env,
	processCwd: string,
): RunGit =>
	createGitRunner({
		platform,
		env,
		processCwd,
		excludeTarget: false,
		timeoutMs: GIT_TIMEOUT_MS,
	});
