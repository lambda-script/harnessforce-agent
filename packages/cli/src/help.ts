// `harnessforce --help`と`harnessforce <command> --help`の文面。送る／送らないの記述は
// 実装（import/send.ts、insights、hook）とHarnessforce本体のspecが正である。

type CommandHelp = {
	summary: string;
	text: string;
};

const SENDS_NOTHING_LOCAL =
	"Nothing. It reads local files only and makes no network request.";

const COMMANDS = {
	login: {
		summary: "Log in and connect this machine to a Workspace",
		text: `Usage: harnessforce login [--port <port>] [--no-plugin-auto-update]

When to use:
  Once per machine, before anything else, and again whenever the login expires.

What it does:
  Opens your browser to log in to a Workspace, then stores a user ingest key and
  an API token in the OS keychain. It configures Claude Code (user settings) and
  Codex (config.toml) to export telemetry to the Workspace. Whether the prompts
  and responses are sent follows "harnessforce config set send-content", which
  logging in again does not change.

Options:
  --port <port>     Loopback port for the login callback, 1-65535 (default 8080).
  --no-plugin-auto-update
                    Turn off automatic updates of the Harnessforce plugin in
                    Claude Code. On by default; a value you set is kept.

Sends:
  The login exchange with the Workspace. After login, the agents you run send
  telemetry (token counts, tool names, timings) with that key.

Does not send:
  Prompt text, model responses and tool input or output (unless send-content is
  on and the Workspace stores that category), code diffs, and secrets. The keys
  stay in the OS keychain, except that Codex reads the user ingest key from
  its config.toml, so that file holds it in plain text.

Exit codes:
  0  Connected and configured.
  1  Failed (login timed out, keychain unavailable, or a write failed). The
     reason is printed to stderr.
  2  Bad arguments. The reason and the usage are printed to stderr.
  130  Cancelled with Ctrl+C. Nothing was changed.

Examples:
  harnessforce login
  harnessforce login --port 8081
`,
	},
	logout: {
		summary: "Revoke this machine's login and remove its settings",
		text: `Usage: harnessforce logout

When to use:
  Before you hand over or retire this machine, or to stop sending from it.

What it does:
  Revokes the user ingest key and the login of this machine in each Workspace it
  is logged in to, then removes them from the OS keychain and removes the
  settings that "harnessforce login" wrote to Claude Code and Codex. The
  send-content setting and the files in ~/.harnessforce/ are kept. Managed
  settings from your organization are not changed.

Sends:
  One revoke request per Workspace, to the Harnessforce it logged in to.

Does not send:
  Anything else.

Exit codes:
  0  Logged out, or there was nothing to log out.
  1  Failed. If communication failed or the keychain was unavailable, the login
     stays active. If removing it from the keychain or the settings failed, it
     is already revoked. Either way, run it again.
  2  Bad arguments.

Examples:
  harnessforce logout
`,
	},
	config: {
		summary: "Turn sending prompts and responses on or off",
		text: `Usage: harnessforce config get send-content
       harnessforce config set send-content on|off

When to use:
  To choose whether this machine sends the prompts you type, model responses
  and tool input and output. The choice stays when you log in again.

What it does:
  get prints "on" or "off". set saves the choice in ~/.harnessforce/config.json
  and rewrites the content settings of Claude Code and Codex. "on" sends only
  the categories the Workspace stores; "off" stops sending them right away.

Sends:
  "set send-content on" on a logged-in machine reads the content settings of the
  Workspace. Nothing else is sent.

Does not send:
  Anything for "get" and "set send-content off".

Exit codes:
  0  Done.
  1  The settings could not be read or written, or the Workspace settings could
     not be read.
  2  Bad arguments.

Examples:
  harnessforce config set send-content on
  harnessforce config set send-content off
  harnessforce config get send-content
`,
	},
	import: {
		summary: "Send past local sessions to the Workspace",
		text: `Usage: harnessforce import

When to use:
  Right after login, to backfill sessions that ran before Harnessforce was
  connected. It is safe to run again; sessions already sent are skipped.

What it does:
  Reads Claude Code and Codex session records on this machine, keeps the
  sessions of repositories assigned to a project and inside the Workspace's
  import window, and sends a summary of each. When it imports nothing, it prints why
  and what to do next.

Sends:
  Per session: agent, session ID, repository, branch, start and end time,
  model, input and output token counts, and tool call counts. Claude Code
  sessions also send the first prompt ID; Codex sessions also send the commit
  the session started on.

Does not send:
  Prompt text, model responses, tool input or output, and code diffs. Sessions
  of repositories not assigned to a project are not sent.

Exit codes:
  0  Finished (including "nothing to import").
  1  Not logged in, keychain unavailable, a limit was reached, or sending failed.
  2  Bad arguments.

Examples:
  harnessforce import
`,
	},
	status: {
		summary: "Show the Workspace setup steps that remain",
		text: `Usage: harnessforce status [--json]

When to use:
  After login, and any time you want to see which setup steps of the connected
  Workspace remain and whether this repository is assigned to a project.

What it does:
  Reads the setup checklist of the connected Workspace and the list of
  repositories assigned to a project, and prints your role, each step (done, to
  do with its URL, or "?" when it cannot be read), and whether the repository of
  the current directory (its origin remote) is assigned to a project. It also
  runs "claude --version" and "codex --version" and names each agent older than
  the oldest version the Harnessforce hooks support.

Options:
  --json   Print the checklist, the repository and the outdated agents as one
           JSON object.

Sends:
  Read requests with the API token. It writes nothing.

Does not send:
  The URL of the origin remote: it is compared on this machine. The agent
  versions it reads.

Exit codes:
  0  The status was read, whether or not steps remain.
  1  Not logged in, the login expired, or communication failed.
  2  Bad arguments.

Examples:
  harnessforce status
  harnessforce status --json
`,
	},
	"otel-headers": {
		summary: "Print the telemetry auth header (used by Claude Code)",
		text: `Usage: harnessforce otel-headers

When to use:
  You normally never run it. Claude Code calls it as its otelHeadersHelper.

What it does:
  Reads the ingest key from the keychain and prints {"Authorization": "Bearer <key>"}
  as JSON on stdout.

Sends:
  ${SENDS_NOTHING_LOCAL}

Does not send:
  Anything. Do not paste its output into chats or logs: it contains the key.

Exit codes:
  0  Header printed.
  3  No key for the Workspace (not logged in, or the keychain item is gone, for
     example after a reboot cleared the kernel keyring).
  4  The destination was not verified: it differs from the origin login pinned.
  5  This CLI version is unsupported. The keychain is not read.
  1  Any other failure (keychain unavailable, read failed, timed out, or bad
     arguments).
  Nothing is printed to stdout unless the exit code is 0.

Examples:
  harnessforce otel-headers
`,
	},
	run: {
		summary: "Start an agent tied to an Issue",
		text: `Usage: harnessforce run --issue <identifier> -- <agent> [args]

When to use:
  When the branch name does not contain the Issue identifier and you want the
  work tied to the Issue anyway.

What it does:
  Starts <agent> (for example claude or codex) with your arguments, with the
  Issue identifier added to the telemetry it exports. Everything after "--" is
  passed to the agent unchanged, including "--help". The agent's exit code is
  returned.

Options:
  --issue <identifier>   The Issue identifier, for example ABC-123.

Sends:
  The same telemetry as an agent started directly, plus the Issue identifier.

Does not send:
  Anything beyond what login configured. Prompt text, responses and tool input
  and output are sent only if send-content is on ("harnessforce config").

Exit codes:
  The agent's own exit code when it ran.
  1  Could not start: not logged in, or the agent was not found.
  2  Bad arguments.

Examples:
  harnessforce run --issue ABC-123 -- claude
  harnessforce run --issue ABC-123 -- codex --model gpt-5
`,
	},
	insights: {
		summary: "Analyze your past sessions and report counts",
		text: `Usage: harnessforce insights [--all] [--no-send] [--show-report] [--json]
       harnessforce insights --quiet [--all]
       harnessforce insights schedule
       harnessforce insights record
       harnessforce insights clear

When to use:
  Periodically (or through /harnessforce:insights) to see where human
  intervention, repeated work, and MCP or tool usage could improve. It needs
  at least 10 sessions.

What it does:
  Imports sessions that were not sent yet, analyzes the local session records,
  and prints the result. Files it writes live under ~/.harnessforce/insights/.

Options:
  --all           Analyze sessions of repositories not assigned to a project
                  too (they are never sent).
  --no-send       Analyze only; send nothing.
  --show-report   Print the exact values that would be sent.
  --json          Print the result as one JSON object on stdout. Messages go to
                  stderr.
  --quiet         Analyze and send, writing nothing to stdout (for your OS
                  scheduler). Combines with --all only.

Subcommands:
  schedule        Print a cron line that runs --quiet every Monday at 9:00. It
                  changes nothing and sends nothing.
  record          Read one proposal as JSON from stdin and store it locally.
                  /harnessforce:insights runs it; you normally do not.
  clear           Delete the analysis, proposals, and unsent results.

Sends:
  Counts computed by public rules (no text), for repositories assigned to a
  project only.
  It also runs the same session import as "harnessforce import".

Does not send:
  Prompt text, model responses, tool input or output, and code diffs. Usage
  statistics and proposals stay on this machine.

Exit codes:
  0  Done (including "not enough data" and "nothing sent").
  1  Not logged in, keychain unavailable, another run of insights is in
     progress, or a local write failed.
  2  Bad option, or invalid input to "record".
  3  Analysis shown, but sending is not possible until you run
     "harnessforce login".

Examples:
  harnessforce insights
  harnessforce insights --no-send --json
  harnessforce insights schedule
  harnessforce insights clear
`,
	},
	top: {
		summary: "Show running and recent sessions on this machine",
		text: `Usage: harnessforce top [--once] [--json] [--ascii] [--theme <auto|light|dark|ansi>]

When to use:
  To watch what your agents are doing right now. In a terminal it is a live
  view; with --once or --json it prints a snapshot and exits.

What it does:
  Reads Claude Code and Codex session records on this machine and shows each
  session's state, repository, branch, tokens, and tool calls.

Options:
  --once    Print one snapshot and exit.
  --json    Print one snapshot as JSON and exit.
  --ascii   Use plain ASCII instead of box-drawing characters.
  --theme   Color theme: auto (default), light, dark, or ansi.

Sends:
  ${SENDS_NOTHING_LOCAL}

Does not send:
  Anything. It never changes any file.

Exit codes:
  0  Done (including quitting the live view).
  2  Bad arguments.

Examples:
  harnessforce top
  harnessforce top --once --json
`,
	},
	hook: {
		summary: "Session hooks (used by Codex)",
		text: `Usage: harnessforce hook session-start|post-tool-use|stop

When to use:
  You normally never run it. Codex runs session-start when a session starts,
  post-tool-use after it edits files with apply_patch, and stop at the end of
  each turn.

What it does:
  session-start reads the hook input from stdin, registers the session with the
  Workspace, and prints context for the agent (the session ID, plus a one-line
  warning if registration failed).
  post-tool-use and stop record the repository and branch of the Git working
  trees the session worked in, and stop sends them when they changed.

Sends:
  Session registration: agent, session ID, repository, branch, commit, and
  start time.
  Work locations: agent, session ID, and the repository and branch of each
  working tree. Paths, commits, and file names are not sent.

Does not send:
  Prompt text, model responses, tool input or output, and code diffs.

Exit codes:
  0  Always, even on failure: a hook must never stop your session. A failure is
     shown as a one-line warning.
  1  Wrong arguments.

Examples:
  harnessforce hook session-start < hook-input.json
`,
	},
} as const satisfies Record<string, CommandHelp>;

type CommandName = keyof typeof COMMANDS;

type OverviewRow = { name: string; summary: string };

const row = (name: CommandName): OverviewRow => ({
	name,
	summary: COMMANDS[name].summary,
});

const YOUR_COMMANDS: readonly OverviewRow[] = [
	row("login"),
	row("logout"),
	row("import"),
	row("status"),
	row("run"),
	row("insights"),
	row("top"),
	row("config"),
];

// 利用者が打たないcommand。keyを出すotel-headersも何であるかを読めるよう、隠さずに別枠で示す。
const AGENT_COMMANDS: readonly OverviewRow[] = [
	row("otel-headers"),
	row("hook"),
	{
		name: "insights record",
		summary: "Store one suggestion (used by /harnessforce:insights)",
	},
];

const NAME_WIDTH =
	Math.max(...[...YOUR_COMMANDS, ...AGENT_COMMANDS].map((r) => r.name.length)) +
	2;

const rows = (list: readonly OverviewRow[]) =>
	list.map((r) => `  ${r.name.padEnd(NAME_WIDTH)}${r.summary}`).join("\n");

const OVERVIEW = `Usage: harnessforce <command> [options]

Connect your AI coding agents to a Harnessforce Workspace.

Commands:
${rows(YOUR_COMMANDS)}

Commands your agents run:
${rows(AGENT_COMMANDS)}

Run "harnessforce <command> --help" for what a command does, what it sends and
does not send, and its exit codes.

Options:
  -h, --help     Show this help.
  --version      Show the version.
`;

// 引数の誤り（vercel、bashのbuiltinと同じ2）。
export const EXIT_USAGE = 2;

// helpの文面の`Usage:`から最初の空行までの行。
function usageLines(name: CommandName): string {
	const text: string = COMMANDS[name].text;
	return text.slice(0, text.indexOf("\n\n") + 1);
}

export function usageError(name: CommandName, reason: string): string {
	return `harnessforce ${name}: ${reason}\n${usageLines(name)}Run "harnessforce ${name} --help" for details.\n`;
}

export const givenTwice = (flag: string) =>
	`"${flag}" was given more than once`;

// 受け付けない引数の理由。`-`で始まればoption、それ以外は余分な引数とする。
export function unexpectedArgument(arg: string): string {
	return arg.startsWith("-")
		? `unknown option "${arg}"`
		: `unexpected argument "${arg}"`;
}

// 打ち間違いの候補にする名前。
const KNOWN_WORDS = [...Object.keys(COMMANDS), "help", "--help", "--version"];

// 隣り合う2文字の入れ替えを1と数える編集距離（optimal string alignment）。
function editDistance(a: string, b: string): number {
	const d = Array.from({ length: a.length + 1 }, (_, i) =>
		Array.from({ length: b.length + 1 }, (_, j) =>
			i === 0 ? j : j === 0 ? i : 0,
		),
	);
	for (let i = 1; i <= a.length; i += 1)
		for (let j = 1; j <= b.length; j += 1) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			let best = Math.min(
				(d[i - 1]?.[j] ?? 0) + 1,
				(d[i]?.[j - 1] ?? 0) + 1,
				(d[i - 1]?.[j - 1] ?? 0) + cost,
			);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
				best = Math.min(best, (d[i - 2]?.[j - 2] ?? 0) + 1);
			(d[i] as number[])[j] = best;
		}
	return d[a.length]?.[b.length] ?? 0;
}

// 距離2以内で最も近い名前。同じ距離ならKNOWN_WORDSの順で先のもの。
function closestWord(word: string): string | undefined {
	let best: { word: string; distance: number } | undefined;
	for (const known of KNOWN_WORDS) {
		const distance = editDistance(word.toLowerCase(), known);
		// 距離0は正しく綴られた語で、`help help`のように使い方が違うだけなので候補にしない。
		if (
			distance > 0 &&
			distance <= 2 &&
			(best === undefined || distance < best.distance)
		)
			best = { word: known, distance };
	}
	return best?.word;
}

const LIST_HINT = 'Run "harnessforce --help" to list the commands.\n';

export function unknownCommand(word: string): string {
	const kind = word.startsWith("-") ? "option" : "command";
	const suggestion = closestWord(word);
	return `harnessforce: unknown ${kind} "${word}"\n${suggestion ? `Did you mean "${suggestion}"?\n` : ""}${LIST_HINT}`;
}

export function topLevelError(reason: string): string {
	return `harnessforce: ${reason}\n${LIST_HINT}`;
}

const isCommand = (name: string | undefined): name is CommandName =>
	name !== undefined && Object.hasOwn(COMMANDS, name);

const isHelpFlag = (arg: string) => arg === "--help" || arg === "-h";

// helpの要求への応答。stdoutの文面か、topicの誤りのstderrの文面。helpの要求でなければundefined。
// `run`は`--`より後ろをagentへそのまま渡すため、その手前の--helpだけを見る。
// 引数なしはclig.devのとおり概要を示す。
export function resolveHelp(
	argv: readonly string[],
): { out: string } | { err: string } | undefined {
	const [command, ...rest] = argv;
	if (command === undefined) return { out: OVERVIEW };
	if (isHelpFlag(command) || command === "help") {
		const [topic, extra] = rest;
		if (topic === undefined || topic === "help" || isHelpFlag(topic))
			return { out: OVERVIEW };
		if (!isCommand(topic)) return { err: unknownCommand(topic) };
		if (extra !== undefined)
			return { err: topLevelError(unexpectedArgument(extra)) };
		return { out: COMMANDS[topic].text };
	}
	if (!isCommand(command)) return undefined;
	const separator = rest.indexOf("--");
	const own = separator === -1 ? rest : rest.slice(0, separator);
	return own.some(isHelpFlag) ? { out: COMMANDS[command].text } : undefined;
}
