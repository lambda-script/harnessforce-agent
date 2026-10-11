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
import { scanSessions } from "./sessions.js";
import {
	type Destination,
	importStatePath,
	readSentSessions,
	recordSentSessions,
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
} as const;

const limitMessage = {
	monthly_event_limit: (count: number) =>
		`月間イベント数の上限に達したため、${count}件のsessionを取り込めませんでした。上限が解除された後に\`harnessforce import\`を再実行すると続きから取り込みます`,
	workspace_read_only: (count: number) =>
		`Workspaceが閲覧のみのため、${count}件のsessionを取り込めませんでした。閲覧のみが解除された後に\`harnessforce import\`を再実行すると続きから取り込みます`,
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

function report(result: SendResult, deps: ImportDeps): number {
	switch (result.kind) {
		case "done":
			deps.stdout(`${result.imported}件のsessionを取り込みました\n`);
			if (result.invalid > 0)
				deps.stdout(
					`形式が不正なため${result.invalid}件のsessionを取り込めませんでした\n`,
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
	const scan = await scanSessions({
		projectsDir: join(await recordBase(deps), "projects"),
		sinceMs: deps.now() - days * DAY_MS,
		connected,
		git: deps.git,
	});
	if (scan.skippedLines > 0 || scan.skippedFiles > 0)
		deps.stdout(
			`読めなかった${scan.skippedLines}行と${scan.skippedFiles}個のfileを読み飛ばしました\n`,
		);
	const statePath = importStatePath(deps.homeDir);
	const sent = await readSentSessions(statePath, destination);
	const result = await sendSessions({
		endpoint: access.ingest,
		ingestKey: access.ingestKey,
		sessions: scan.sessions.filter((s) => !sent.has(s.session_id)),
		fetch: deps.fetch,
		sleep: deps.sleep,
		record: (ids) =>
			recordSentSessions(statePath, destination, ids).catch(() =>
				stopWith(MESSAGES.stateFailed),
			),
	});
	return report(result, deps);
}

// correlation.md「session import」の`harnessforce import`。
export function importCommand(deps: ImportDeps): Promise<number> {
	return runUntilStop(() => runImport(deps), deps.stderr);
}
