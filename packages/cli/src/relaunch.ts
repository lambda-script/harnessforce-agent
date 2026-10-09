import {
	relaunchWithoutRuntimeVariables,
	type SpawnSelf,
} from "@harnessforce/agent-core/process/runtime-env";
import type { Env } from "@harnessforce/agent-core/types";

// keyやtokenを送るsubcommand。`harnessforce otel-headers`は通信を行わないため起動し直さない（correlation.md「Node.jsの実行時の変数」）。
const SENDING_COMMANDS = new Set(["init", "run", "import", "hook"]);
const HOOK_RESTART_FAILED =
	"harnessforce: session registration skipped (restart failed)";
const RESTART_FAILED = "harnessforceを起動し直せませんでした";

type RelaunchDeps = {
	platform: NodeJS.Platform;
	env: Env;
	spawnSelf: SpawnSelf;
	stderr: (text: string) => void;
};

// 起動し直した場合はその終了コード、このprocessで続ける場合はundefinedを返す。
export async function relaunchHf(
	argv: readonly string[],
	deps: RelaunchDeps,
): Promise<number | undefined> {
	if (!SENDING_COMMANDS.has(argv[0] ?? "")) return undefined;
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
		return 0;
	}
	deps.stderr(`${RESTART_FAILED}\n`);
	return 1;
}
