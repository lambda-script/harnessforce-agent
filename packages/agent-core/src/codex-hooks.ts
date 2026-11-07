// correlation.md「Codex」: harnessforce initが`config.toml`の`[hooks]`へ書くhandler。
// using-harnessforceの「What is sent, and when」の表と照合するため、pluginのtestからも読む。
export type CodexHookSpec = Readonly<{
	event: "SessionStart" | "PostToolUse" | "Stop";
	subcommand: string;
	matcher?: string;
	// correlation.md「sessionの作業位置」: 作業位置のhookはagentを待たせない。
	isAsync?: boolean;
}>;

export const CODEX_HOOKS: readonly CodexHookSpec[] = [
	{ event: "SessionStart", subcommand: "session-start" },
	{
		event: "PostToolUse",
		subcommand: "post-tool-use",
		matcher: "^apply_patch$",
		isAsync: true,
	},
	{ event: "Stop", subcommand: "stop", isAsync: true },
];
