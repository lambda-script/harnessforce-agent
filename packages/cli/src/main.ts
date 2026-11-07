import { createRequire } from "node:module";
import {
	type ClientIdentity,
	recordingFetch,
} from "@harnessforce/agent-core/client-update";
import type { RunGit } from "@harnessforce/agent-core/process/git";
import {
	isSendingBlocked,
	noticeUpdate,
	readCliUpdateState,
	updateStatePath,
} from "./client-update.js";
import {
	EXIT_USAGE,
	givenTwice,
	resolveHelp,
	topLevelError,
	unexpectedArgument,
	unknownCommand,
	usageError,
} from "./help.js";
import { sessionStart } from "./hook/session-start.js";
import { workLocationHook } from "./hook/work-location.js";
import { type ImportDeps, importCommand } from "./import/command.js";
import { type InitArgs, type InitDeps, init } from "./init/init.js";
import { otelHeaders } from "./otel-headers.js";
import {
	type RunArgs,
	type RunDeps,
	runIssue,
	runWithoutHarnessforce,
} from "./run/run.js";
import type { AgentVersionReader } from "./status/agent-versions.js";
import { parseStatusArgs, statusCommand } from "./status/command.js";
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
		// Codexのhookが作業位置の記録を置くOSの一時directory。
		hookTmpDir: string;
		// stdoutを閉じ、書いた分が渡るのを待つ。otel-headersが出力の後に処理を続ける前に呼ぶ。
		endStdout: () => Promise<void>;
		// 実行中の`harnessforce`の絶対path。`harnessforce tune --print-schedule`が使う。
		selfPath: string;
		// 接続先を与えたbuild（npmへ配らない）。`User-Agent`に`-dev`を付ける（client-updates.md「版の申告」）。
		devBuild: boolean;
		// `harnessforce status`が端末のclaudeとcodexの版を読む。
		agentVersion: AgentVersionReader;
	};

// src（test）とdist（公開物）のどちらから読んでも、1つ上がpackage.jsonになる。
const { version } = createRequire(import.meta.url)("../package.json") as {
	version: string;
};

// client-updates.md「送信の停止」: CLIの状態のfileがunsupportedの間、keyを出力しない終了コード。
const EXIT_CLIENT_UNSUPPORTED = 5;
// correlation.md「CLI」: otel-headersの終了コードはClaude Codeとhookとの契約で、3、4、5以外の失敗は1とする。
const EXIT_OTEL_HEADERS_OTHER = 1;
// hookの引数の誤り。agentのhookはexit 2を処理を止める合図として扱うため、2を使わない。
const EXIT_HOOK_USAGE = 1;

// 受け付けない引数の理由。
type ArgError = { error: string };

const twice = (flag: string): ArgError => ({ error: givenTwice(flag) });
const needsValue = (flag: string): ArgError => ({
	error: `"${flag}" needs a value`,
});

// `harnessforce init`の引数。--portの値は1〜65535の整数（correlation.md「CLI」）。
// --urlは検証者と開発者の接続先の上書きで、利用者向けのUSAGEには載せない。
function parseInitArgs(args: readonly string[]): InitArgs | ArgError {
	let url: string | undefined;
	let port: number | undefined;
	let sendContent = false;
	let noPluginAutoUpdate = false;
	for (let i = 0; i < args.length; ) {
		const arg = args[i] as string;
		const value = args[i + 1];
		if (arg === "--url") {
			if (url !== undefined) return twice(arg);
			if (value === undefined) return needsValue(arg);
			url = value;
			i += 2;
			continue;
		}
		if (arg === "--port") {
			if (port !== undefined) return twice(arg);
			if (value === undefined) return needsValue(arg);
			const parsed = /^\d+$/.test(value) ? Number(value) : 0;
			if (parsed < 1 || parsed > 65535)
				return { error: '"--port" must be an integer from 1 to 65535' };
			port = parsed;
			i += 2;
			continue;
		}
		if (arg === "--send-content") {
			if (sendContent) return twice(arg);
			sendContent = true;
			i += 1;
			continue;
		}
		if (arg === "--no-plugin-auto-update") {
			if (noPluginAutoUpdate) return twice(arg);
			noPluginAutoUpdate = true;
			i += 1;
			continue;
		}
		return { error: unexpectedArgument(arg) };
	}
	return { url, port, sendContent, noPluginAutoUpdate };
}

// `harnessforce run`の引数。`--`より後ろはagentとその引数としてそのまま渡す。
function parseRunArgs(args: readonly string[]): RunArgs | ArgError {
	const [flag, issue, separator, agent, ...agentArgs] = args;
	if (flag !== "--issue")
		return {
			error:
				flag?.startsWith("-") && flag !== "--"
					? unexpectedArgument(flag)
					: 'missing "--issue <identifier>"',
		};
	if (issue === undefined || issue === "--")
		return { error: '"--issue" needs an Issue identifier' };
	if (separator?.startsWith("-") && separator !== "--")
		return { error: unexpectedArgument(separator) };
	if (separator !== "--")
		return { error: 'missing "--" before the agent command' };
	if (!agent) return { error: 'missing the agent command after "--"' };
	return { issue, agent, agentArgs };
}

const isArgError = (parsed: object): parsed is ArgError => "error" in parsed;

export async function run(
	argv: readonly string[],
	deps: CliDeps,
): Promise<number> {
	const help = resolveHelp(argv);
	if (help !== undefined) {
		if ("err" in help) {
			deps.stderr(help.err);
			return EXIT_USAGE;
		}
		deps.stdout(help.out);
		return 0;
	}
	const [command, ...rest] = argv;
	const fail = (text: string, code = EXIT_USAGE) => {
		deps.stderr(text);
		return code;
	};
	if (command === "--version") {
		if (rest.length > 0)
			return fail(topLevelError(unexpectedArgument(rest[0] as string)));
		deps.stdout(`${version}\n`);
		return 0;
	}
	const client: ClientIdentity = {
		component: "cli",
		version,
		dev: deps.devBuild,
	};
	// Harnessforceへの要求に版を申告し、応答の更新の状態を保存する。
	const cli: CliDeps = {
		...deps,
		fetch: recordingFetch(
			deps.fetch,
			client,
			updateStatePath(deps.homeDir),
			deps.now,
		),
	};
	const updateDeps = { ...cli, client };
	const unsupported = async () =>
		(await readCliUpdateState(deps.homeDir, version))?.status === "unsupported";
	// 送信を伴うcommandは、unsupportedの間は何も送らずに終え、終えた後に更新の状態を1行示す。
	const guarded = async (command: () => Promise<number>) => {
		if (await isSendingBlocked(updateDeps)) {
			await noticeUpdate(updateDeps);
			return 1;
		}
		const code = await command();
		await noticeUpdate(updateDeps);
		return code;
	};
	// 引数を取らないcommandに余分な引数がある。
	const [extra] = rest;
	if (
		(command === "otel-headers" || command === "import") &&
		extra !== undefined
	)
		return fail(
			usageError(command, unexpectedArgument(extra)),
			command === "otel-headers" ? EXIT_OTEL_HEADERS_OTHER : EXIT_USAGE,
		);
	if (command === "otel-headers") {
		// 状態のfileを読むだけで通信しない。古いCLIが利用者用のIngestKeyをClaude CodeのOTLPへ渡し続けないためである。
		if (await unsupported()) return EXIT_CLIENT_UNSUPPORTED;
		return otelHeaders(
			cli.env,
			cli.managedDir,
			cli.keychain,
			cli.stdout,
			cli.stderr,
			cli.endStdout,
		);
	}
	if (command === "import")
		return guarded(() =>
			importCommand({
				...cli,
				git: cli.importGit,
				now: () => cli.now().getTime(),
			}),
		);
	if (command === "status") {
		// 引数の誤りは、更新の状態によらず使い方で答える。
		const status = parseStatusArgs(rest);
		if (typeof status === "string") return fail(usageError("status", status));
		return guarded(() =>
			statusCommand(status, {
				...cli,
				git: cli.importGit,
				now: () => cli.now().getTime(),
			}),
		);
	}
	if (command === "tune")
		return guarded(() =>
			tuneCommand(rest, {
				...cli,
				git: cli.importGit,
				now: () => cli.now().getTime(),
			}),
		);
	if (command === "hook") {
		const [event, ...hookExtra] = rest;
		const hookDeps = {
			env: cli.env,
			homeDir: cli.homeDir,
			now: cli.now,
			git: cli.hookGit,
			fetch: cli.fetch,
			keychain: cli.keychain,
			readStdin: cli.readStdin,
			stdout: cli.stdout,
			stderr: cli.stderr,
			client,
			defaultUrl: cli.defaultUrl,
		};
		const hookUsage = (reason: string) =>
			fail(usageError("hook", reason), EXIT_HOOK_USAGE);
		if (event === undefined) return hookUsage("missing the hook event");
		if (
			event !== "session-start" &&
			event !== "post-tool-use" &&
			event !== "stop"
		)
			return hookUsage(`unknown hook event "${event}"`);
		const [unexpected] = hookExtra;
		if (unexpected !== undefined)
			return hookUsage(unexpectedArgument(unexpected));
		if (event === "session-start") return sessionStart(hookDeps);
		return workLocationHook(event, {
			...hookDeps,
			hookTmpDir: cli.hookTmpDir,
		});
	}
	if (command === "top")
		return topCommand(rest, {
			homeDir: cli.homeDir,
			managedDir: cli.managedDir,
			env: cli.env,
			stdout: cli.stdout,
			stderr: cli.stderr,
			now: () => cli.now().getTime(),
			git: cli.importGit,
			top: cli.top,
		});
	if (command === "init") {
		const initArgs = parseInitArgs(rest);
		if (isArgError(initArgs)) return fail(usageError("init", initArgs.error));
		return guarded(() => init(initArgs, cli));
	}
	if (command === "run") {
		const runArgs = parseRunArgs(rest);
		if (isArgError(runArgs)) return fail(usageError("run", runArgs.error));
		// agentの実行は止めず、Harnessforceのための環境を付けずに起動する（client-updates.md「送信の停止」）。
		if (await isSendingBlocked(updateDeps)) {
			await noticeUpdate(updateDeps);
			return runWithoutHarnessforce(runArgs, cli);
		}
		await noticeUpdate(updateDeps);
		return runIssue(runArgs, cli);
	}
	return fail(unknownCommand(command as string));
}
