import { createRequire } from "node:module";
import { type InitDeps, init } from "./init/init.js";
import { otelHeaders } from "./otel-headers.js";
import { type RunArgs, type RunDeps, runIssue } from "./run/run.js";

// managedDirはhf otel-headersがWorkspace用のkeyを読むfileと、hf runが構成を集めるmanagedの基点のdirectory。
export type CliDeps = InitDeps & RunDeps;

// src（test）とdist（公開物）のどちらから読んでも、1つ上がpackage.jsonになる。
const { version } = createRequire(import.meta.url)("../package.json") as {
	version: string;
};

const USAGE =
	"Usage: hf --version | hf init [--url <base URL>] | hf otel-headers | hf run --issue <identifier> -- <agent> [args]\n";

// `hf init`の引数。受け付けない形ならundefined。
function parseInitArgs(
	args: readonly string[],
): { url: string | undefined } | undefined {
	if (args.length === 0) return { url: undefined };
	if (args.length === 2 && args[0] === "--url") return { url: args[1] };
	return undefined;
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
	const initArgs = command === "init" ? parseInitArgs(rest) : undefined;
	if (initArgs) return init(initArgs.url, deps);
	const runArgs = command === "run" ? parseRunArgs(rest) : undefined;
	if (runArgs) return runIssue(runArgs, deps);
	deps.stderr(USAGE);
	return 1;
}
