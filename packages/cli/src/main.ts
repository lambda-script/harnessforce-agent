import { createRequire } from "node:module";

type Io = { stdout: (text: string) => void; stderr: (text: string) => void };

// src（test）とdist（公開物）のどちらから読んでも、1つ上がpackage.jsonになる。
const { version } = createRequire(import.meta.url)("../package.json") as {
	version: string;
};

export function run(argv: readonly string[], io: Io): number {
	if (argv.length === 1 && argv[0] === "--version") {
		io.stdout(`${version}\n`);
		return 0;
	}
	io.stderr("Usage: hf --version\n");
	return 1;
}
