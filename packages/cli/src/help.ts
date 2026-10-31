// `harnessforce --help`と`harnessforce <command> --help`の文面。送る／送らないの記述は
// 実装（import/send.ts、tune、hook）とHarnessforce本体のspecが正である。

type CommandHelp = {
	summary: string;
	text: string;
};

const SENDS_NOTHING_LOCAL =
	"Nothing. It reads local files only and makes no network request.";

const COMMANDS = {
	init: {
		summary: "Connect this machine to a Harnessforce Workspace",
		text: `Usage: harnessforce init [--port <port>] [--send-content] [--no-plugin-auto-update]

When to use:
  Once per machine, before anything else, and again whenever the login expires.

What it does:
  Opens your browser to log in to a Workspace, then stores a user ingest key and
  an API token in the OS keychain. It configures Claude Code (user settings) and
  Codex (config.toml) to export telemetry to the Workspace.

Options:
  --port <port>     Loopback port for the login callback, 1-65535 (default 8080).
  --send-content    Also send the prompts you type, model responses and tool
                    input and output. Takes effect only for the categories the
                    Workspace stores. Without it, init turns all of them off.
  --no-plugin-auto-update
                    Turn off automatic updates of the Harnessforce plugin in
                    Claude Code. On by default; a value you set is kept.

Sends:
  The login exchange with the Workspace. After init, the agents you run send
  telemetry (token counts, tool names, timings) with that key.

Does not send:
  Prompt text, model responses and tool input or output (unless --send-content
  and the Workspace stores that category), code diffs, and secrets. The key is
  never written to a plain file.

Exit codes:
  0  Connected and configured.
  1  Failed (login cancelled or timed out, keychain unavailable, or a write
     failed). The reason is printed to stderr.

Examples:
  harnessforce init
  harnessforce init --send-content
  harnessforce init --port 8081
`,
	},
	import: {
		summary: "Send past local sessions to the Workspace",
		text: `Usage: harnessforce import

When to use:
  Right after init, to backfill sessions that ran before Harnessforce was
  connected. It is safe to run again; sessions already sent are skipped.

What it does:
  Reads Claude Code and Codex session records on this machine, keeps the
  sessions of repositories connected to the Workspace and inside its import
  window, and sends a summary of each. When it imports nothing, it prints why
  and what to do next.

Sends:
  Per session: agent, session ID, repository, branch, start and end time,
  model, input and output token counts, and tool call counts. Claude Code
  sessions also send the first prompt ID; Codex sessions also send the commit
  the session started on.

Does not send:
  Prompt text, model responses, tool input or output, and code diffs. Sessions
  of repositories that are not connected are not sent.

Exit codes:
  0  Finished (including "nothing to import").
  1  Not logged in, keychain unavailable, a limit was reached, or sending failed.

Examples:
  harnessforce import
`,
	},
	status: {
		summary: "Show the Workspace setup steps that remain",
		text: `Usage: harnessforce status [--json]

When to use:
  After init, and any time you want to see which setup steps of the connected
  Workspace remain and whether this repository is connected to the GitHub App.

What it does:
  Reads the setup checklist of the connected Workspace and the list of
  connected repositories, and prints your role, each step (done, to do with its
  URL, or "?" when it cannot be read), and whether the repository of the current
  directory (its origin remote) is connected.

Options:
  --json   Print the checklist and the repository as one JSON object.

Sends:
  Read requests with the API token. It writes nothing.

Does not send:
  The URL of the origin remote: it is compared on this machine.

Exit codes:
  0  The status was read, whether or not steps remain.
  1  Not logged in, the login expired, or communication failed.

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
  4  The destination was not verified: it differs from the origin init pinned.
  5  This CLI version is unsupported. The keychain is not read.
  1  Any other failure (keychain unavailable, read failed, or timed out).
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
  Anything beyond what init configured. Prompt text, responses and tool input
  and output are sent only if you chose --send-content at init.

Exit codes:
  The agent's own exit code when it ran.
  1  Could not start: not logged in, bad arguments, or the agent was not found.

Examples:
  harnessforce run --issue ABC-123 -- claude
  harnessforce run --issue ABC-123 -- codex --model gpt-5
`,
	},
	tune: {
		summary: "Analyze your past sessions and report counts",
		text: `Usage: harnessforce tune [--all] [--no-send] [--show-report] [--json]
       harnessforce tune --report-only [--all]
       harnessforce tune --print-schedule
       harnessforce tune record
       harnessforce tune --purge

When to use:
  Periodically (or through /harnessforce:tune) to see where human intervention,
  repeated work, and MCP or tool usage could improve. It needs at least 10
  sessions.

What it does:
  Imports sessions that were not sent yet, analyzes the local session records,
  and prints the result. Files it writes live under ~/.harnessforce/tune/.

Options:
  --all           Analyze sessions of repositories not connected too (they are
                  never sent).
  --no-send       Analyze only; send nothing.
  --show-report   Print the exact values that would be sent.
  --json          Print the result as one JSON object on stdout. Messages go to
                  stderr.
  --report-only   Analyze and send, writing nothing to stdout (for your OS
                  scheduler). Combines with --all only.
  --print-schedule
                  Print a cron line that runs --report-only every Monday at
                  9:00. It changes nothing and sends nothing.
  record          Read one proposal as JSON from stdin and store it locally.
  --purge         Delete the analysis, proposals, and unsent results.

Sends:
  Counts computed by public rules (no text), for connected repositories only.
  It also runs the same session import as "harnessforce import".

Does not send:
  Prompt text, model responses, tool input or output, and code diffs. Usage
  statistics and proposals stay on this machine.

Exit codes:
  0  Done (including "not enough data" and "nothing sent").
  1  Not logged in, keychain unavailable, another tune is running, or a local
     write failed.
  2  Bad option, or invalid input to "record".
  3  Analysis shown, but sending is not possible until you run "harnessforce init".

Examples:
  harnessforce tune
  harnessforce tune --no-send --json
  harnessforce tune --print-schedule
  harnessforce tune --purge
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
  1  Bad arguments.

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

const ORDER: readonly CommandName[] = [
	"init",
	"import",
	"status",
	"run",
	"tune",
	"top",
	"otel-headers",
	"hook",
];

const NAME_WIDTH = Math.max(...ORDER.map((name) => name.length)) + 2;

const OVERVIEW = `Usage: harnessforce <command> [options]

Connect your AI coding agents to a Harnessforce Workspace.

Commands:
${ORDER.map((name) => `  ${name.padEnd(NAME_WIDTH)}${COMMANDS[name].summary}`).join("\n")}

Run "harnessforce <command> --help" for what a command does, what it sends and
does not send, and its exit codes.

Options:
  -h, --help     Show this help.
  --version      Show the version.
`;

export const UNKNOWN_COMMAND_HINT = `Usage: harnessforce <command> [options]
Run "harnessforce --help" to list the commands.
`;

const isCommand = (name: string | undefined): name is CommandName =>
	name !== undefined && Object.hasOwn(COMMANDS, name);

const isHelpFlag = (arg: string) => arg === "--help" || arg === "-h";

// helpとして出す文面。helpの要求でなければundefined。
// `run`は`--`より後ろをagentへそのまま渡すため、その手前の--helpだけを見る。
export function resolveHelp(argv: readonly string[]): string | undefined {
	const [command, ...rest] = argv;
	if (command === undefined) return undefined;
	if (isHelpFlag(command) && rest.length === 0) return OVERVIEW;
	if (command === "help") {
		if (rest.length === 0) return OVERVIEW;
		if (rest.length === 1 && isCommand(rest[0])) return COMMANDS[rest[0]].text;
		return undefined;
	}
	if (!isCommand(command)) return undefined;
	const separator = rest.indexOf("--");
	const own = separator === -1 ? rest : rest.slice(0, separator);
	return own.some(isHelpFlag) ? COMMANDS[command].text : undefined;
}
