import { type SendDeps, sendUsageLimits } from "./send.js";
import { type StatuslineDeps, statusline } from "./statusline.js";

export type UsageLimitsDeps = StatuslineDeps &
	SendDeps & { stderr: (text: string) => void };

const USAGE_LIMITS_USAGE = "Usage: harnessforce usage-limits statusline\n";

export async function usageLimitsCommand(
	args: readonly string[],
	deps: UsageLimitsDeps,
): Promise<number> {
	const [subcommand, payload] = args;
	if (subcommand === "statusline" && args.length === 1) return statusline(deps);
	if (subcommand === "send" && payload !== undefined && args.length === 2)
		return sendUsageLimits(payload, deps);
	deps.stderr(USAGE_LIMITS_USAGE);
	return 1;
}
