// usage-limits.md「同意」の文面と、`harnessforce usage-limits`の終端の文言。
export const CONSENT_TEXT =
	"Everyone in this workspace can see your usage limits together with your name (only the usage percentage and reset time of each window, such as 5 hours and 7 days). No prompt or other content is sent. You can stop at any time, and stopping deletes the stored values. They are not used to rank members.";

export const CONSENT_PROMPT = "Do you agree? [y/N] ";

export const MESSAGES = {
	windows: "Sharing usage limits cannot be set up on Windows in this version",
	settingsUnreadable: "Cannot read the Claude Code user settings",
	statusLineUnsupported: "This statusLine cannot be embedded",
	noUserKey: "This device has no user ingest key. Run `harnessforce init`",
	keychainUnavailable:
		"The OS keychain is unavailable, so sharing usage limits cannot be set up",
	invalidUrl: "The connection URL is invalid",
	loginExpired: "Your login has expired. Run `harnessforce init`",
	notAgreed: "Consent was not given, so nothing was changed",
	invalidTextVersion:
		"The usage-limits consent text of this CLI is outdated or too new. Update `harnessforce`",
	viewer:
		"The view-only role cannot share usage limits. Contact a Workspace administrator",
	readOnly:
		"This Workspace is view-only, so sharing usage limits cannot be set up",
	failed: "Communication with Harnessforce failed. Try again",
	saveFailed:
		"Could not write the device settings, so the consent was revoked. Try again",
	revokeFailedAfterSave:
		"Could not write the device settings and failed to revoke the consent. Check the state with `harnessforce usage-limits status`, then run `harnessforce usage-limits off`",
	notOptedIn:
		"Consent recorded. The values are not stored until the Workspace has opted in to recording usage limits",
	enabled: "Sharing usage limits is enabled. Restart Claude Code to apply it",
	disabled:
		"Stopped sharing usage limits and requested deletion of the stored values",
	revokedButNotRestored:
		"Consent was revoked, but the statusLine could not be restored. Run `harnessforce usage-limits off` again",
	usage:
		"Usage: harnessforce usage-limits on [--yes] | harnessforce usage-limits off | harnessforce usage-limits status | harnessforce usage-limits statusline\n",
} as const;

export const STATUS_LABELS = {
	consent: {
		shared: "agreed",
		notShared: "not agreed",
		outdated: "outdated text",
		unknown: "unknown",
	},
	optIn: { on: "enabled", off: "disabled", unknown: "unknown" },
	statusLine: {
		embeddedWithOriginal: "embedded (original command present)",
		embeddedWithoutOriginal: "embedded (no original command)",
		notEmbedded: "not embedded",
	},
} as const;
