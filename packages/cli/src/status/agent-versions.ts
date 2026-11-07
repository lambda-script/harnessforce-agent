import { execFile } from "node:child_process";
import {
	commandLineFor,
	findCommand,
	type LookupFileSystem,
} from "@harnessforce/agent-core/process/lookup";
import type { Env } from "@harnessforce/agent-core/types";

// onboarding.md「harnessforce status」とcorrelation.md「agentの版」。端末のclaudeとcodexが、hookが動く最小の版より古いかを確かめる。

type AgentCommand = "claude" | "codex";

// `<command> --version`のstdout。見つからない、上限時間を超えた、0以外で終わった場合はundefined。
export type AgentVersionReader = (
	command: AgentCommand,
) => Promise<string | undefined>;

export type OutdatedAgent = {
	agent: "claude_code" | "codex";
	version: string;
	minimum: string;
};

// correlation.md「agentの版」の表。Codexはreleaseの名前の`rust-v`を除いた形。
const AGENTS = [
	{
		agent: "claude_code",
		command: "claude",
		name: "Claude Code",
		minimum: "2.1.214",
	},
	{ agent: "codex", command: "codex", name: "Codex", minimum: "0.148.0" },
] as const;

// 起動ごとの上限。statusの表示を待たせない。
const VERSION_TIMEOUT_MS = 1000;

// stdoutで最初に現れる`<数>.<数>.<数>`。続くpre-releaseとbuildの部分は読まない。
function parseVersion(stdout: string | undefined): string | undefined {
	return stdout?.match(/\d+\.\d+\.\d+/)?.[0];
}

function isOlder(version: string, minimum: string): boolean {
	const a = version.split(".").map(Number);
	const b = minimum.split(".").map(Number);
	for (let i = 0; i < 3; i += 1) {
		const diff = (a[i] ?? 0) - (b[i] ?? 0);
		if (diff !== 0) return diff < 0;
	}
	return false;
}

// Claude Code、Codexの順。
export async function readOutdatedAgents(
	read: AgentVersionReader,
): Promise<OutdatedAgent[]> {
	// spec: 読めないagentはその行を出さないだけで、statusを失敗させない。
	const versions = await Promise.all(
		AGENTS.map(async (agent) =>
			parseVersion(await read(agent.command).catch(() => undefined)),
		),
	);
	return AGENTS.flatMap((agent, i) => {
		const version = versions[i];
		return version !== undefined && isOlder(version, agent.minimum)
			? [{ agent: agent.agent, version, minimum: agent.minimum }]
			: [];
	});
}

export function outdatedAgentLine(outdated: OutdatedAgent): string {
	const name = AGENTS.find((a) => a.agent === outdated.agent)?.name;
	return `${name} ${outdated.version} is older than ${outdated.minimum}, the oldest version the Harnessforce hooks support. Update ${name}.`;
}

type ReaderOptions = {
	platform: NodeJS.Platform;
	env: Env;
	cwd: string;
	timeoutMs?: number;
	fs?: LookupFileSystem;
};

// correlation.md「commandの解決」で絶対pathへ解決してから起動する。版はHarnessforceへ送らない。
export function createAgentVersionReader({
	platform,
	env,
	cwd,
	timeoutMs = VERSION_TIMEOUT_MS,
	fs,
}: ReaderOptions): AgentVersionReader {
	const context = { platform, env, bases: [cwd], ...(fs ? { fs } : {}) };
	const childEnv = Object.fromEntries(
		Object.entries(env).filter(
			(entry): entry is [string, string] => entry[1] !== undefined,
		),
	);
	return async (command) => {
		const file = await findCommand(command, context);
		const line =
			file === undefined
				? undefined
				: await commandLineFor(file, ["--version"], context);
		if (line === undefined) return undefined;
		return new Promise((resolve) => {
			execFile(
				line.file,
				line.args,
				{
					encoding: "utf8",
					env: childEnv,
					timeout: timeoutMs,
					windowsHide: true,
					windowsVerbatimArguments: line.verbatim,
				},
				(error, stdout) => resolve(error ? undefined : stdout),
			);
		});
	};
}
