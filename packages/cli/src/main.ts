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
import { resolveHelp, UNKNOWN_COMMAND_HINT } from "./help.js";
import { HOOK_USAGE, sessionStart } from "./hook/session-start.js";
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
import { topCommand } from "./top/command.js";
import type { TopIo } from "./top/io.js";
import { type TuneCommandDeps, tuneCommand } from "./tune/tune.js";
import {
	type UsageLimitsDeps,
	usageLimitsCommand,
} from "./usage-limits/command.js";

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
		// harnessforce usage-limits statusline: 元のstatusLineのcommandの実行と、切り離した送信の子process。
		runOriginal: UsageLimitsDeps["runOriginal"];
		spawnSender: UsageLimitsDeps["spawnSender"];
		ask: UsageLimitsDeps["ask"];
		// stdoutを閉じ、書いた分が渡るのを待つ。otel-headersが出力の後に処理を続ける前に呼ぶ。
		endStdout: () => Promise<void>;
		// 接続先を与えたbuild（npmへ配らない）。`User-Agent`に`-dev`を付ける（client-updates.md「版の申告」）。
		devBuild: boolean;
	};

// src（test）とdist（公開物）のどちらから読んでも、1つ上がpackage.jsonになる。
const { version } = createRequire(import.meta.url)("../package.json") as {
	version: string;
};

// client-updates.md「送信の停止」: CLIの状態のfileがunsupportedの間、keyを出力しない終了コード。
const EXIT_CLIENT_UNSUPPORTED = 5;
// 資格情報を伴う要求を送るusage-limitsのsubcommand。
const SENDING_USAGE_LIMITS = new Set(["on", "off", "status"]);

// `harnessforce init`の引数。受け付けない形ならundefined。--portの値は1〜65535の整数（correlation.md「CLI」）。
// --urlは検証者と開発者の接続先の上書きで、利用者向けのUSAGEには載せない。
function parseInitArgs(args: readonly string[]): InitArgs | undefined {
	let url: string | undefined;
	let port: number | undefined;
	let sendContent = false;
	let noPluginAutoUpdate = false;
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
		if (args[i] === "--send-content") {
			if (sendContent) return undefined;
			sendContent = true;
			i += 1;
			continue;
		}
		if (args[i] === "--no-plugin-auto-update") {
			if (noPluginAutoUpdate) return undefined;
			noPluginAutoUpdate = true;
			i += 1;
			continue;
		}
		return undefined;
	}
	return { url, port, sendContent, noPluginAutoUpdate };
}

// `harnessforce run`の引数。`--`より後ろはagentとその引数としてそのまま渡す。
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
	const help = resolveHelp(argv);
	if (help !== undefined) {
		deps.stdout(help);
		return 0;
	}
	const [command, ...rest] = argv;
	if (command === "--version" && rest.length === 0) {
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
	if (command === "otel-headers" && rest.length === 0) {
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
	if (command === "import" && rest.length === 0)
		return guarded(() =>
			importCommand({
				...cli,
				git: cli.importGit,
				now: () => cli.now().getTime(),
			}),
		);
	if (command === "tune")
		return guarded(() =>
			tuneCommand(rest, {
				...cli,
				git: cli.importGit,
				now: () => cli.now().getTime(),
			}),
		);
	if (command === "hook") {
		const [event] = rest;
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
		if (rest.length === 1 && event === "session-start")
			return sessionStart(hookDeps);
		if (rest.length === 1 && (event === "post-tool-use" || event === "stop"))
			return workLocationHook(event, {
				...hookDeps,
				temporaryDirectory: cli.hookTmpDir,
			});
		cli.stderr(HOOK_USAGE);
		return 1;
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
	if (command === "usage-limits") {
		// statusLineから切り離した送信の子processは、何も送らずに終える。statusLineの表示と終了コードは変わらない。
		if (rest[0] === "send" && (await unsupported())) return 0;
		return SENDING_USAGE_LIMITS.has(rest[0] ?? "")
			? guarded(() => usageLimitsCommand(rest, cli))
			: usageLimitsCommand(rest, cli);
	}
	const initArgs = command === "init" ? parseInitArgs(rest) : undefined;
	if (initArgs) return guarded(() => init(initArgs, cli));
	const runArgs = command === "run" ? parseRunArgs(rest) : undefined;
	if (runArgs) {
		// agentの実行は止めず、Harnessforceのための環境を付けずに起動する（client-updates.md「送信の停止」）。
		if (await isSendingBlocked(updateDeps)) {
			await noticeUpdate(updateDeps);
			return runWithoutHarnessforce(runArgs, cli);
		}
		await noticeUpdate(updateDeps);
		return runIssue(runArgs, cli);
	}
	cli.stderr(UNKNOWN_COMMAND_HINT);
	return 1;
}
