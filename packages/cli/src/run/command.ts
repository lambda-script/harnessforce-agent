import { posix, win32 } from "node:path";
import {
	type CommandLine,
	commandLineFor,
	type Env,
	findCommand,
	isRunnable,
	type LookupFileSystem,
} from "../process/lookup.js";

// correlation.md「CLI」の`hf run`の手順7と「commandの解決」。agentのfileを解決し、起動するcommand lineを作る。
export type ResolveOptions = {
	platform: NodeJS.Platform;
	env: Env;
	cwd: string;
	fs?: LookupFileSystem;
};

export type { CommandLine };

const hasSeparator = (command: string, platform: NodeJS.Platform) =>
	platform === "win32" ? /[\\/]/.test(command) : command.includes("/");

const contextFor = ({ platform, env, cwd, fs }: ResolveOptions) => ({
	platform,
	env,
	bases: [cwd],
	...(fs ? { fs } : {}),
});

export async function resolveAgentFile(
	command: string,
	options: ResolveOptions,
): Promise<string | undefined> {
	if (!hasSeparator(command, options.platform))
		return findCommand(command, contextFor(options));
	// 利用者が明示したpathはそのまま使い、PATHEXTを付け足さない。
	const path = options.platform === "win32" ? win32 : posix;
	const file = path.resolve(options.cwd, command);
	return (await isRunnable(file, options)) ? file : undefined;
}

export function commandLine(
	file: string,
	args: readonly string[],
	options: ResolveOptions,
): Promise<CommandLine | undefined> {
	return commandLineFor(file, args, contextFor(options));
}
