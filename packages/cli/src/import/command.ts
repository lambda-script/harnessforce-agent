import { join } from "node:path";
import type { RunGit } from "@harnessforce/agent-core/process/git";
import type { Env, Fetch } from "@harnessforce/agent-core/types";
import { withoutExtras } from "@harnessforce/agent-core/url";
import { type AccessMessages, verifyCliAccess } from "../credentials/access.js";
import { createApiTokenSession } from "../credentials/api-token-session.js";
import type { Keychain } from "../credentials/keychain.js";
import { INIT_MESSAGES } from "../shared/messages.js";
import { runUntilStop, stopWith } from "../shared/stop.js";
import {
	fetchSessionImportDays,
	listConnectedRepositories,
	type ReadOutcome,
} from "./read-api.js";
import { recordBase } from "./record-base.js";
import { type SendResult, sendSessions } from "./send.js";
import {
	type NotImported,
	scanCodexSessions,
	scanSessions,
} from "./sessions.js";
import {
	type Destination,
	importStatePath,
	readSentSessions,
	recordSentSessions,
	sessionStateKey,
} from "./state.js";

export type ImportDeps = {
	env: Env;
	keychain: Keychain;
	stdout: (text: string) => void;
	stderr: (text: string) => void;
	fetch: Fetch;
	homeDir: string;
	managedDir: string;
	defaultUrl: string;
	git: RunGit;
	now: () => number;
	sleep: (ms: number) => Promise<void>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// correlation.md「session import」「CLIの宛先の決め方」「CLI」が定める文言。
const MESSAGES = {
	runInit: "`harnessforce init`を実行してください",
	invalidUrl: "接続先のURLが不正です",
	keychainUnavailable: INIT_MESSAGES.keychainUnavailable,
	readFailed:
		"Harnessforceとの通信に失敗しました。もう一度`harnessforce import`を実行してください",
	sendFailed:
		"Harnessforceとの通信に失敗しました。もう一度`harnessforce import`を実行すると続きから取り込みます",
	revoked: "送信キーが失効しています。`harnessforce init`を実行してください",
	loginExpired:
		"ログインの有効期限が切れました。`harnessforce init`を実行してください",
	stateFailed: "取り込みの状態を保存できませんでした",
	connectNone:
		"WorkspaceにGitHubのリポジトリが接続されていません。HarnessforceでGitHub Appを接続すると、`harnessforce import`で取り込めます",
	connectOther:
		"セッションのリポジトリがWorkspaceに接続されていません。HarnessforceでそのリポジトリをGitHub Appに接続すると、`harnessforce import`で取り込めます",
	nothingFound: "取り込めるセッションの記録が見つかりませんでした",
} as const;

const limitMessage = {
	monthly_event_limit: (count: number) =>
		`月間イベント数の上限に達したため、${count}件のセッションを取り込めませんでした。上限が解除された後に\`harnessforce import\`を再実行すると続きから取り込みます`,
	workspace_read_only: (count: number) =>
		`Workspaceが閲覧のみのため、${count}件のセッションを取り込めませんでした。閲覧のみが解除された後に\`harnessforce import\`を再実行すると続きから取り込みます`,
};

const ACCESS_MESSAGES: AccessMessages = {
	keychainUnavailable: MESSAGES.keychainUnavailable,
	initRequired: MESSAGES.runInit,
	invalidUrl: MESSAGES.invalidUrl,
	apiTokenMissing: MESSAGES.runInit,
};

function unwrap<T>(outcome: ReadOutcome<T>): T {
	if (outcome.kind === "ok") return outcome.value;
	// 401はrefreshしても使えるaccess tokenを得られなかった場合だけ届く。
	return stopWith(
		outcome.kind === "unauthorized"
			? MESSAGES.loginExpired
			: MESSAGES.readFailed,
	);
}

// correlation.md「session import」の取り込まなかったsessionの内訳。1件以上の理由だけを、決まった順で示す。
const NOT_IMPORTED_LABELS = [
	["alreadySent", "送信済み"],
	["outOfRange", "期間外"],
	["outsideGit", "gitのリポジトリの外"],
	["notConnected", "Workspaceに接続されていないリポジトリ"],
] as const;

type Breakdown = Record<(typeof NOT_IMPORTED_LABELS)[number][0], number>;

function breakdownLine(breakdown: Breakdown): string | undefined {
	const parts = NOT_IMPORTED_LABELS.filter(([key]) => breakdown[key] > 0).map(
		([key, label]) => `${label}${breakdown[key]}件`,
	);
	return parts.length > 0
		? `取り込まなかったセッション: ${parts.join("、")}`
		: undefined;
}

type Notes = {
	breakdown: Breakdown;
	// 内訳とは別の専用の表示が出たか。
	otherNoticeShown: boolean;
	connectedCount: number;
};

function reportNotImported(
	imported: number,
	notes: Notes,
	deps: ImportDeps,
): void {
	const line = breakdownLine(notes.breakdown);
	if (line) deps.stdout(`${line}\n`);
	if (imported > 0) return;
	if (notes.breakdown.notConnected > 0)
		deps.stdout(
			`${notes.connectedCount === 0 ? MESSAGES.connectNone : MESSAGES.connectOther}\n`,
		);
	else if (!line && !notes.otherNoticeShown)
		deps.stdout(`${MESSAGES.nothingFound}\n`);
}

function report(result: SendResult, notes: Notes, deps: ImportDeps): number {
	switch (result.kind) {
		case "done":
			deps.stdout(`${result.imported}件のセッションを取り込みました\n`);
			if (result.invalid > 0)
				deps.stdout(
					`形式が不正なため${result.invalid}件のセッションを取り込めませんでした\n`,
				);
			reportNotImported(
				result.imported,
				{
					...notes,
					otherNoticeShown: notes.otherNoticeShown || result.invalid > 0,
				},
				deps,
			);
			return 0;
		case "limited":
			deps.stderr(`${limitMessage[result.reason](result.notImported)}\n`);
			return 1;
		case "unauthorized":
			deps.stderr(`${MESSAGES.revoked}\n`);
			return 1;
		case "failed":
			deps.stderr(`${MESSAGES.sendFailed}\n`);
			return 1;
	}
}

const sumNotImported = (a: NotImported, b: NotImported): NotImported => ({
	outOfRange: a.outOfRange + b.outOfRange,
	outsideGit: a.outsideGit + b.outsideGit,
	notConnected: a.notConnected + b.notConnected,
});

async function runImport(deps: ImportDeps): Promise<number> {
	const access = await verifyCliAccess(deps, ACCESS_MESSAGES);
	// 状態fileの記録は、Workspaceとingestの送信先の組ごとに分ける。
	const destination: Destination = {
		workspaceId: access.workspaceId,
		endpoint: withoutExtras(access.ingest),
	};
	const readFetch = createApiTokenSession({
		keychain: deps.keychain,
		workspaceId: access.workspaceId,
		readBase: access.readApiBase,
		fetch: deps.fetch,
		now: deps.now,
		sleep: deps.sleep,
		homeDir: deps.homeDir,
	}).authorizedFetch(deps.fetch);
	// sessionは、access tokenの期限切れと401でrefreshしたtokenへAuthorizationを置き換える。
	const connected = unwrap(
		await listConnectedRepositories(
			access.readApiBase,
			access.accessToken,
			readFetch,
		),
	);
	const days = unwrap(
		await fetchSessionImportDays(
			access.readApiBase,
			access.accessToken,
			readFetch,
		),
	);
	const sinceMs = deps.now() - days * DAY_MS;
	const claude = await scanSessions({
		projectsDir: join(await recordBase(deps), "projects"),
		sinceMs,
		connected,
		git: deps.git,
	});
	// Codexの記録の基点は`~/.codex`に固定する。processの環境変数のCODEX_HOMEは、repositoryのsettingsが書き換えられるため読まない。
	const codex = await scanCodexSessions({
		codexDir: join(deps.homeDir, ".codex"),
		sinceMs,
		connected,
		git: deps.git,
	});
	const skippedLines = claude.skippedLines + codex.skippedLines;
	const skippedFiles = claude.skippedFiles + codex.skippedFiles;
	if (skippedLines > 0 || skippedFiles > 0)
		deps.stdout(
			`読めなかった${skippedLines}行と${skippedFiles}個のファイルを読み飛ばしました\n`,
		);
	if (codex.unextractable > 0)
		deps.stdout(
			`modelまたはtoken数を読めないCodexのセッション${codex.unextractable}個は取り込みませんでした\n`,
		);
	if (codex.compressed > 0)
		deps.stdout(
			`圧縮されたCodexのセッションの記録${codex.compressed}個は読めないため取り込みませんでした\n`,
		);
	const scanned = [...claude.sessions, ...codex.sessions];
	const statePath = importStatePath(deps.homeDir);
	const sent = await readSentSessions(statePath, destination);
	const unsent = scanned.filter((s) => !sent.has(sessionStateKey(s)));
	const result = await sendSessions({
		endpoint: access.ingest,
		ingestKey: access.ingestKey,
		sessions: unsent,
		fetch: deps.fetch,
		sleep: deps.sleep,
		record: (ids) =>
			recordSentSessions(statePath, destination, ids).catch(() =>
				stopWith(MESSAGES.stateFailed),
			),
	});
	return report(
		result,
		{
			breakdown: {
				alreadySent: scanned.length - unsent.length,
				...sumNotImported(claude.notImported, codex.notImported),
			},
			otherNoticeShown:
				skippedLines > 0 ||
				skippedFiles > 0 ||
				codex.unextractable > 0 ||
				codex.compressed > 0,
			connectedCount: connected.size,
		},
		deps,
	);
}

// correlation.md「session import」の`harnessforce import`。
export function importCommand(deps: ImportDeps): Promise<number> {
	return runUntilStop(() => runImport(deps), deps.stderr);
}
