import { createRequire } from "node:module";
import { type ImportDeps, importCommand } from "./import/command.js";
import { type InitDeps, init } from "./init/init.js";
import { otelHeaders } from "./otel-headers.js";
import { type RunArgs, type RunDeps, runIssue } from "./run/run.js";
import { type TuneCommandDeps, tuneCommand } from "./tune/tune.js";

// hf tuneはhf importと同じgitの呼び出しの上限でcwdのrepositoryを求める。
// managedDirはhf otel-headersがWorkspace用のkeyを読むfileと、hf runが構成を集めるmanagedの基点のdirectory。
// hf importはgitの呼び出しの上限がhf runと異なるため、別のrunnerをimportGitで受け取る。
export type CliDeps = InitDeps &
	RunDeps &
	Omit<ImportDeps, "git" | "now"> & {
		importGit: ImportDeps["git"];
		readStdin: TuneCommandDeps["readStdin"];
	};

// src（test）とdist（公開物）のどちらから読んでも、1つ上がpackage.jsonになる。
const { version } = createRequire(import.meta.url)("../package.json") as {
	version: string;
};

const USAGE =
	"Usage: hf --version | hf init [--url <base URL>] [--port <port>] | hf import | hf otel-headers | hf run --issue <identifier> -- <agent> [args] | hf tune [--all] [--no-send] [--show-report] [--json] | hf tune record | hf tune --purge\n";

// `hf init`の引数。受け付けない形ならundefined。--portの値は1〜65535の整数（correlation.md「CLI」）。
function parseInitArgs(
	args: readonly string[],
): { url: string | undefined; port: number | undefined } | undefined {
	let url: string | undefined;
	let port: number | undefined;
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
		return undefined;
	}
	return { url, port };
}

// `hf run`の引数。`--`より後ろはagentとその引数としてそのまま渡す。
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
	const initArgs = command === "init" ? parseInitArgs(rest) : undefined;
	if (initArgs) return init(initArgs, deps);
	const runArgs = command === "run" ? parseRunArgs(rest) : undefined;
	if (runArgs) return runIssue(runArgs, deps);
	deps.stderr(USAGE);
	return 1;
}
