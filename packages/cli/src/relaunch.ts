import {
	relaunchWithoutRuntimeVariables,
	type SpawnSelf,
} from "./process/runtime-env.js";

// keyやtokenを送るsubcommand。`hf otel-headers`は通信を行わないため起動し直さない（correlation.md「Node.jsの実行時の変数」）。
const SENDING_COMMANDS = new Set(["init", "run", "import"]);
const RESTART_FAILED = "hfを起動し直せませんでした";

type RelaunchDeps = {
	platform: NodeJS.Platform;
	env: Readonly<Record<string, string | undefined>>;
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
	deps.stderr(`${RESTART_FAILED}\n`);
	return 1;
}
