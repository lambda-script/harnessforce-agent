import { INIT_MESSAGES } from "../shared/messages.js";

// correlation.md「CLIの宛先の決め方」「CLI」の`harnessforce run`が定める文言。
export const RUN_MESSAGES = {
	keychainUnavailable: INIT_MESSAGES.keychainUnavailable,
	initRequired: "Run `harnessforce init`",
	invalidUrl: INIT_MESSAGES.invalidUrl,
	invalidIssue: "The Issue identifier is invalid",
	issueInitRequired: "Could not resolve the Issue. Run `harnessforce init`",
	loginExpired: "Your login has expired. Run `harnessforce init`",
	issueFailed: "Could not resolve the Issue or fetch candidates",
	noMatch: "No matching Issue",
	candidatesHeader: "Could not resolve the Issue. Candidates:",
} as const;

export type RunMessage = keyof typeof RUN_MESSAGES;

export const launchFailedMessage = (agent: string) =>
	`Could not start ${agent}`;
