import { createRequire } from "node:module";
import { type InitDeps, init } from "./init/init.js";
import { otelHeaders } from "./otel-headers.js";

// managedDirはhf otel-headersがWorkspace用のkeyを読むfileのdirectory。
export type CliDeps = InitDeps & { managedDir: string };

// src（test）とdist（公開物）のどちらから読んでも、1つ上がpackage.jsonになる。
const { version } = createRequire(import.meta.url)("../package.json") as {
	version: string;
};

const USAGE =
	"Usage: hf --version | hf init [--url <base URL>] | hf otel-headers\n";

// `hf init`の引数。受け付けない形ならundefined。
function parseInitArgs(
	args: readonly string[],
): { url: string | undefined } | undefined {
	if (args.length === 0) return { url: undefined };
	if (args.length === 2 && args[0] === "--url") return { url: args[1] };
	return undefined;
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
	deps.stderr(USAGE);
	return 1;
}
