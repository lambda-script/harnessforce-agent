import { createRequire } from "node:module";
import type { RunGit } from "@harnessforce/agent-core/process/git";
import { HOOK_USAGE, sessionStart } from "./hook/session-start.js";
import { type ImportDeps, importCommand } from "./import/command.js";
import { type InitArgs, type InitDeps, init } from "./init/init.js";
import { otelHeaders } from "./otel-headers.js";
import { type RunArgs, type RunDeps, runIssue } from "./run/run.js";
import { topCommand } from "./top/command.js";
import type { TopIo } from "./top/io.js";
import { type TuneCommandDeps, tuneCommand } from "./tune/tune.js";

// harnessforce tuneはharnessforce importと同じgitの呼び出しの上限でcwdのrepositoryを求める。
// managedDirはharnessforce otel-headersがWorkspace用のkeyを読むfileと、harnessforce runが構成を集めるmanagedの基点のdirectory。
// harnessforce importはgitの呼び出しの上限がharnessforce runと異なるため、別のrunnerをimportGitで受け取る。
export type CliDeps = InitDeps &
	RunDeps &
	Omit<ImportDeps, "git" | "now"> & {
		importGit: ImportDeps["git"];
		readStdin: TuneCommandDeps["readStdin"];
		top: TopIo;
		// hookが使うgit。hookのprocessの現在のdirectoryとsessionのrepositoryの外から解決する。
		hookGit: RunGit;
	};

// src（test）とdist（公開物）のどちらから読んでも、1つ上がpackage.jsonになる。
const { version } = createRequire(import.meta.url)("../package.json") as {
	version: string;
};

const USAGE =
	"Usage: harnessforce --version | harnessforce init [--url <base URL>] [--port <port>] [--send-content] | harnessforce import | harnessforce otel-headers | harnessforce run --issue <identifier> -- <agent> [args] | harnessforce tune [--all] [--no-send] [--show-report] [--json] | harnessforce tune record | harnessforce tune --purge | harnessforce hook session-start | harnessforce top [--once] [--json] [--ascii] [--theme <auto|light|dark|ansi>]\n";

// `harnessforce init`の引数。受け付けない形ならundefined。--portの値は1〜65535の整数（correlation.md「CLI」）。
function parseInitArgs(args: readonly string[]): InitArgs | undefined {
	let url: string | undefined;
	let port: number | undefined;
	let sendContent = false;
	for (let i = 0; i < args.length; ) {
		if (args[i] === "--url") {
			if (url !== undefined || args[i + 1] === undefined) return undefined;
			url = args[i + 1];
			i += 2;
			continue;
		}
		if (args[i] === "--port") {
			const value = args[i + 1];
			if (port !== undefined || value === undefined || !/^\d+$/.test(value))
				return undefined;
			const parsed = Number(value);
			if (parsed < 1 || parsed > 65535) return undefined;
			port = parsed;
			i += 2;
			continue;
		}
		if (args[i] === "--send-content") {
			if (sendContent) return undefined;
			sendContent = true;
			i += 1;
			continue;
		}
		return undefined;
	}
	return { url, port, sendContent };
}

// `harnessforce run`の引数。`--`より後ろはagentとその引数としてそのまま渡す。
function parseRunArgs(args: readonly string[]): RunArgs | undefined {
	const [flag, issue, separator, agent, ...agentArgs] = args;
	if (flag !== "--issue" || issue === undefined || separator !== "--")
		return undefined;
	return agent ? { issue, agent, agentArgs } : undefined;
}

export async function run(
	argv: readonly string[],
	deps: CliDeps,
): Promise<number> {
	const [command, ...rest] = argv;
	if (command === "--version" && rest.length === 0) {
		deps.stdout(`${version}\n`);
		return 0;
	}
	if (command === "otel-headers" && rest.length === 0)
		return otelHeaders(
			deps.env,
			deps.managedDir,
			deps.keychain,
			deps.stdout,
			deps.stderr,
		);
	if (command === "import" && rest.length === 0)
		return importCommand({
			...deps,
			git: deps.importGit,
			now: () => deps.now().getTime(),
		});
	if (command === "tune")
		return tuneCommand(rest, {
			...deps,
			git: deps.importGit,
			now: () => deps.now().getTime(),
		});
	if (command === "hook") {
		if (rest.length !== 1 || rest[0] !== "session-start") {
			deps.stderr(HOOK_USAGE);
			return 1;
		}
		return sessionStart({
			env: deps.env,
			homeDir: deps.homeDir,
			now: deps.now,
			git: deps.hookGit,
			fetch: deps.fetch,
			keychain: deps.keychain,
			readStdin: deps.readStdin,
			stdout: deps.stdout,
			stderr: deps.stderr,
		});
	}
	if (command === "top")
		return topCommand(rest, {
			homeDir: deps.homeDir,
			managedDir: deps.managedDir,
			env: deps.env,
			stdout: deps.stdout,
			stderr: deps.stderr,
			now: () => deps.now().getTime(),
			git: deps.importGit,
			top: deps.top,
		});
	const initArgs = command === "init" ? parseInitArgs(rest) : undefined;
	if (initArgs) return init(initArgs, deps);
	const runArgs = command === "run" ? parseRunArgs(rest) : undefined;
	if (runArgs) return runIssue(runArgs, deps);
	deps.stderr(USAGE);
	return 1;
}
