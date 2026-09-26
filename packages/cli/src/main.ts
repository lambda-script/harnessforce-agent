import { createRequire } from "node:module";
import type { Keychain } from "./credentials/keychain.js";
import { type Env, otelHeaders } from "./otel-headers.js";

export type CliDeps = {
	env: Env;
	keychain: Keychain;
	stdout: (text: string) => void;
	stderr: (text: string) => void;
};

// src（test）とdist（公開物）のどちらから読んでも、1つ上がpackage.jsonになる。
const { version } = createRequire(import.meta.url)("../package.json") as {
	version: string;
};

const USAGE = "Usage: hf --version | hf otel-headers\n";

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
		return otelHeaders(deps.env, deps.keychain, deps.stdout);
	deps.stderr(USAGE);
	return 1;
}
