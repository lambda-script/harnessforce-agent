import {
	DESTINATION_MISMATCH_MESSAGE,
	LOGIN_MESSAGES,
	NOT_LOGGED_IN_MESSAGE,
} from "../shared/messages.js";

// correlation.md「CLIの宛先の決め方」「CLI」の`harnessforce run`が定める文言。
export const RUN_MESSAGES = {
	keychainUnavailable: LOGIN_MESSAGES.keychainUnavailable,
	loginRequired: NOT_LOGGED_IN_MESSAGE,
	destinationMismatch: DESTINATION_MISMATCH_MESSAGE,
	invalidUrl: LOGIN_MESSAGES.invalidUrl,
	invalidIssue: "The Issue identifier is invalid",
	issueLoginRequired:
		"Could not resolve the Issue because you are not logged in to Harnessforce. Run `harnessforce login`",
	loginExpired: "Your login has expired. Run `harnessforce login`",
	issueFailed: "Could not resolve the Issue or fetch candidates",
	noMatch: "No matching Issue",
	candidatesHeader: "Could not resolve the Issue. Candidates:",
} as const;

export type RunMessage = keyof typeof RUN_MESSAGES;

export const launchFailedMessage = (agent: string) =>
	`Could not start ${agent}`;
