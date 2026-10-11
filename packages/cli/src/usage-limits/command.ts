import {
	type ManageDeps,
	offCommand,
	onCommand,
	statusCommand,
} from "./manage.js";
import { MESSAGES } from "./messages.js";
import { type SendDeps, sendUsageLimits } from "./send.js";
import { type StatuslineDeps, statusline } from "./statusline.js";

export type UsageLimitsDeps = StatuslineDeps & SendDeps & ManageDeps;

export async function usageLimitsCommand(
	args: readonly string[],
	deps: UsageLimitsDeps,
): Promise<number> {
	const [subcommand, payload] = args;
	if (subcommand === "statusline" && args.length === 1) return statusline(deps);
	if (subcommand === "send" && payload !== undefined && args.length === 2)
		return sendUsageLimits(payload, deps);
	const isYes = args[1] === "--yes";
	if (
		subcommand === "on" &&
		(args.length === 1 || (args.length === 2 && isYes))
	)
		return onCommand(isYes, deps);
	if (subcommand === "off" && args.length === 1) return offCommand(deps);
	if (subcommand === "status" && args.length === 1) return statusCommand(deps);
	deps.stderr(MESSAGES.usage);
	return 1;
}
