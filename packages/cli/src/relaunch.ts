import { RESTART_FAILED_WARNING } from "@harnessforce/agent-core/hook-warning";
import {
	relaunchWithoutRuntimeVariables,
	type SpawnSelf,
} from "@harnessforce/agent-core/process/runtime-env";
import type { Env } from "@harnessforce/agent-core/types";
import { canInsightsSend } from "./insights/insights.js";

// keyやtokenを送るsubcommand。`harnessforce otel-headers`と`harnessforce config get`は通信を行わないため起動し直さない（correlation.md「Node.jsの実行時の変数」）。
// `harnessforce config set`は、ログイン済みかと値による分岐の前に起動し直すため、`off`とログイン済みでない場合も起動し直す。
// `harnessforce insights`は送りうる分析だけを起動し直し、通信を行わない`record`、`clear`、`schedule`、`--no-send`を付けた分析は起動し直さない。
const SENDING_COMMANDS = new Set([
	"login",
	"logout",
	"run",
	"import",
	"status",
	"hook",
]);
const isSending = (argv: readonly string[]) =>
	SENDING_COMMANDS.has(argv[0] ?? "") ||
	(argv[0] === "config" && argv[1] === "set") ||
	(argv[0] === "insights" && canInsightsSend(argv.slice(1)));
const HOOK_RESTART_FAILED =
	"harnessforce: session registration skipped (restart failed)";
const RESTART_FAILED = "Could not restart harnessforce";

type RelaunchDeps = {
	platform: NodeJS.Platform;
	env: Env;
	spawnSelf: SpawnSelf;
	stdout: (text: string) => void;
	stderr: (text: string) => void;
};

// 起動し直した場合はその終了コード、このprocessで続ける場合はundefinedを返す。
export async function relaunchHf(
	argv: readonly string[],
	deps: RelaunchDeps,
): Promise<number | undefined> {
	if (!isSending(argv)) return undefined;
	const outcome = await relaunchWithoutRuntimeVariables({
		platform: deps.platform,
		env: deps.env,
		stash: true,
		spawnSelf: deps.spawnSelf,
	});
	if (outcome.kind === "not-needed") return undefined;
	if (outcome.kind === "exited") return outcome.code;
	// hookはどの失敗でもsessionを止めず、常にexit 0で終える（correlation.md「hook」）。
	if (argv[0] === "hook") {
		deps.stderr(`${HOOK_RESTART_FAILED}\n`);
		// correlation.md「hookの警告」: Codexのhookは平文の警告1行だけを出す。
		deps.stdout(`${RESTART_FAILED_WARNING}\n`);
		return 0;
	}
	deps.stderr(`${RESTART_FAILED}\n`);
	return 1;
}
