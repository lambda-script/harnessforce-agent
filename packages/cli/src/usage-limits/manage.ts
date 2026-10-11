import type { Fetch } from "@harnessforce/agent-core/types";
import {
	type AccessDeps,
	type AccessMessages,
	type CliAccess,
	verifyCliAccess,
} from "../credentials/access.js";
import { createApiTokenSession } from "../credentials/api-token-session.js";
import {
	readUserSettings,
	userSettingsPath,
	writeUserSettings,
} from "../shared/settings.js";
import { isStop, runUntilStop, stopWith } from "../shared/stop.js";
import {
	type ConsentRead,
	readConsent,
	recordConsent,
	revokeConsent,
} from "./consent.js";
import {
	CURRENT_TEXT_VERSION,
	readMark,
	removeMarkAndState,
	writeMark,
} from "./files.js";
import {
	CONSENT_PROMPT,
	CONSENT_TEXT,
	MESSAGES,
	STATUS_LABELS,
} from "./messages.js";
import {
	canEmbed,
	embedStatusLine,
	isStatusLineEmbedded,
	originalFor,
	restoreStatusLine,
} from "./statusline-settings.js";

export type ManageDeps = AccessDeps & {
	fetch: Fetch;
	now: () => Date;
	sleep: (ms: number) => Promise<void>;
	platform: NodeJS.Platform;
	// 利用者への質問と答え。
	ask: (question: string) => Promise<string>;
	stdout: (text: string) => void;
	stderr: (text: string) => void;
};

const ACCESS_MESSAGES: AccessMessages = {
	keychainUnavailable: MESSAGES.keychainUnavailable,
	initRequired: MESSAGES.noUserKey,
	invalidUrl: MESSAGES.invalidUrl,
	apiTokenMissing: MESSAGES.noUserKey,
};

// 日本語の環境では日本語、それ以外は英語の文面を示す。
function language(env: ManageDeps["env"]): "ja" | "en" {
	const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
	return locale.toLowerCase().startsWith("ja") ? "ja" : "en";
}

function consentClient(deps: ManageDeps, access: CliAccess) {
	const authorized = createApiTokenSession({
		keychain: deps.keychain,
		workspaceId: access.workspaceId,
		readBase: access.readApiBase,
		fetch: deps.fetch,
		now: () => deps.now().getTime(),
		sleep: deps.sleep,
		homeDir: deps.homeDir,
	}).authorizedFetch(deps.fetch);
	const base = access.readApiBase;
	return {
		read: () => readConsent(base, authorized),
		record: () => recordConsent(base, authorized, CURRENT_TEXT_VERSION),
		revoke: () => revokeConsent(base, authorized),
	};
}

const settingsPathOf = (deps: ManageDeps) =>
	userSettingsPath(deps.env, deps.homeDir);

// usage-limits.md「statusLineの組み込み」。手順の番号は仕様のもの。
async function runOn(yes: boolean, deps: ManageDeps): Promise<number> {
	// 手順1
	if (deps.platform === "win32") return stopWith(MESSAGES.windows);
	const access = await verifyCliAccess(deps, ACCESS_MESSAGES);
	const client = consentClient(deps, access);
	// 手順2
	const read = await readUserSettings(settingsPathOf(deps));
	if (read.kind === "invalid") return stopWith(MESSAGES.settingsUnreadable);
	if (!canEmbed(read.settings)) return stopWith(MESSAGES.statusLineUnsupported);
	const settings = read.settings;
	// 手順4の前: Workspaceのopt-inの状態。取れなければ表示せずに続ける。
	const before = await client.read();
	// 手順3
	const lang = language(deps.env);
	deps.stdout(`${CONSENT_TEXT[lang]}\n`);
	if (!yes && (await deps.ask(CONSENT_PROMPT[lang])).trim() !== "y")
		return stopWith(MESSAGES.notAgreed);
	// 手順4
	const recorded = await client.record();
	if (recorded.kind === "unauthorized") return stopWith(MESSAGES.loginExpired);
	if (recorded.kind === "invalid_text_version")
		return stopWith(MESSAGES.invalidTextVersion);
	if (recorded.kind === "viewer") return stopWith(MESSAGES.viewer);
	if (recorded.kind === "read_only") return stopWith(MESSAGES.readOnly);
	if (recorded.kind === "failed") return stopWith(MESSAGES.failed);
	// 手順5〜7。失敗したら同意を撤回して終える。
	const mark = await readMark(deps.homeDir);
	const undo = async () => {
		// 前の印があれば、元のstatusLineを失わないよう同意だけ外して残す。
		await (mark
			? writeMark(deps.homeDir, { ...mark, consented: false })
			: removeMarkAndState(deps.homeDir)
		).catch(() => {});
		const revoked = await client.revoke();
		return stopWith(
			revoked.kind === "ok"
				? MESSAGES.saveFailed
				: MESSAGES.revokeFailedAfterSave,
		);
	};
	try {
		await writeMark(deps.homeDir, {
			consented: true,
			text_version: CURRENT_TEXT_VERSION,
			original: originalFor(settings, mark),
		});
	} catch {
		return undo();
	}
	try {
		await writeUserSettings(settingsPathOf(deps), embedStatusLine(settings));
	} catch {
		return undo();
	}
	const optedOut = before.kind === "ok" && !before.state.workspaceOptedIn;
	deps.stdout(`${optedOut ? MESSAGES.notOptedIn : MESSAGES.enabled}\n`);
	return 0;
}

// usage-limits.md「`off`がuser settingsを元に戻す規則」。
async function runOff(deps: ManageDeps): Promise<number> {
	const access = await verifyCliAccess(deps, ACCESS_MESSAGES);
	const client = consentClient(deps, access);
	// 同意の撤回の通信が失敗したら、user settingsと印を変えずに終える。
	const revoked = await client.revoke();
	if (revoked.kind === "unauthorized") return stopWith(MESSAGES.loginExpired);
	if (revoked.kind === "failed") return stopWith(MESSAGES.failed);
	const mark = await readMark(deps.homeDir);
	const read = await readUserSettings(settingsPathOf(deps));
	// 戻せないまま印を消すと、元のstatusLineを失う。送らないよう同意の印だけ外し、元の値は残す。
	const keepWithoutConsent = async () => {
		if (mark)
			await writeMark(deps.homeDir, { ...mark, consented: false }).catch(
				() => {},
			);
		return stopWith(MESSAGES.revokedButNotRestored);
	};
	if (read.kind === "invalid") return keepWithoutConsent();
	if (isStatusLineEmbedded(read.settings)) {
		try {
			await writeUserSettings(
				settingsPathOf(deps),
				restoreStatusLine(read.settings, mark?.original ?? null),
			);
		} catch {
			return keepWithoutConsent();
		}
	}
	await removeMarkAndState(deps.homeDir).catch(() => {});
	deps.stdout(`${MESSAGES.disabled}\n`);
	return 0;
}

// GETが返すのは`shared`と現行の版だけで、古い版で同意したことは端末の印からしか分からない。
function consentLabel(
	result: ConsentRead,
	mark: Awaited<ReturnType<typeof readMark>>,
): string {
	if (result.kind !== "ok") return STATUS_LABELS.consent.unknown;
	if (result.state.shared) return STATUS_LABELS.consent.shared;
	const isOutdated =
		mark?.consented === true &&
		mark.text_version !== result.state.currentTextVersion;
	return isOutdated
		? STATUS_LABELS.consent.outdated
		: STATUS_LABELS.consent.notShared;
}

// 値は表示しない。
async function runStatus(deps: ManageDeps): Promise<number> {
	const mark = await readMark(deps.homeDir);
	const read = await readUserSettings(settingsPathOf(deps));
	const embedded = read.kind === "ok" && isStatusLineEmbedded(read.settings);
	const statusLine = !embedded
		? STATUS_LABELS.statusLine.notEmbedded
		: mark?.original
			? STATUS_LABELS.statusLine.embeddedWithOriginal
			: STATUS_LABELS.statusLine.embeddedWithoutOriginal;
	// 接続できない端末でも、端末の状態は示す。
	const result = await readRemote(deps);
	deps.stdout(
		[
			`本人の同意: ${consentLabel(result, mark)}`,
			`Workspaceのopt-in: ${
				result.kind !== "ok"
					? STATUS_LABELS.optIn.unknown
					: result.state.workspaceOptedIn
						? STATUS_LABELS.optIn.on
						: STATUS_LABELS.optIn.off
			}`,
			`statusLineの組み込み: ${statusLine}`,
			"",
		].join("\n"),
	);
	return 0;
}

async function readRemote(deps: ManageDeps): Promise<ConsentRead> {
	try {
		const access = await verifyCliAccess(deps, ACCESS_MESSAGES);
		return await consentClient(deps, access).read();
	} catch (error) {
		if (isStop(error)) return { kind: "failed" };
		throw error;
	}
}

export function onCommand(yes: boolean, deps: ManageDeps): Promise<number> {
	return runUntilStop(() => runOn(yes, deps), deps.stderr);
}
export function offCommand(deps: ManageDeps): Promise<number> {
	return runUntilStop(() => runOff(deps), deps.stderr);
}
export const statusCommand = runStatus;
