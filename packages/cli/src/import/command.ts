import { dirname, join } from "node:path";
import { isObject } from "../config/files.js";
import {
	apiTokenAccount,
	ingestKeyAccount,
	ingestOriginAccount,
	type Keychain,
	urlOriginAccount,
} from "../credentials/keychain.js";
import type { Fetch } from "../init/http.js";
import { INIT_MESSAGES } from "../init/messages.js";
import { readUserSettings, userSettingsPath } from "../init/settings.js";
import type { Env } from "../otel-headers.js";
import { parseAllowedUrl } from "../url.js";
import {
	fetchSessionImportDays,
	listConnectedRepositories,
	type ReadOutcome,
} from "./read-api.js";
import type { RunGit } from "./repository.js";
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
	defaultUrl: string;
	git: RunGit;
	now: () => number;
	sleep: (ms: number) => Promise<void>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// correlation.md「session import」「CLIの宛先の決め方」「CLI」が定める文言。
const MESSAGES = {
	runInit: "`hf init`を実行してください",
	invalidUrl: "接続先のURLが不正です",
	keychainUnavailable: INIT_MESSAGES.keychainUnavailable,
	readFailed:
		"Harnessforceとの通信に失敗しました。もう一度`hf import`を実行してください",
	sendFailed:
		"Harnessforceとの通信に失敗しました。もう一度`hf import`を実行すると続きから取り込みます",
	revoked: "送信キーが失効しています。`hf init`を実行してください",
	stateFailed: "取り込みの状態を保存できませんでした",
} as const;

const limitMessage = {
	monthly_event_limit: (count: number) =>
		`月間イベント数の上限に達したため、${count}件のsessionを取り込めませんでした。上限が解除された後に\`hf import\`を再実行すると続きから取り込みます`,
	workspace_read_only: (count: number) =>
		`Workspaceが閲覧のみのため、${count}件のsessionを取り込めませんでした。閲覧のみが解除された後に\`hf import\`を再実行すると続きから取り込みます`,
};

class ImportStop {
	constructor(readonly message: string) {}
}
const stop = (message: string): never => {
	throw new ImportStop(message);
};

type Resolved = {
	destination: Destination;
	endpoint: URL;
	ingestKey: string;
	apiToken: string;
	readBase: URL;
};

// user settingsの`env`の文字列の値。読めないfileは値が無いものとする。
async function readSettingsEnv(
	deps: ImportDeps,
): Promise<Record<string, string | undefined>> {
	const read = await readUserSettings(userSettingsPath(deps.env, deps.homeDir));
	const env = read.kind === "ok" ? read.settings.env : undefined;
	if (!isObject(env)) return {};
	return Object.fromEntries(
		Object.entries(env).filter(([, value]) => typeof value === "string"),
	) as Record<string, string>;
}

// 送信先のURLからscheme、host、port、pathだけを残す（hookの送信先と同じ規則）。状態fileの鍵にも使う。
const withoutExtras = (url: URL) =>
	`${url.origin}${url.pathname.replace(/\/+$/, "")}`;

// correlation.md「CLI」のWorkspaceの決め方、「CLIの宛先の決め方」、送信先の固定。
async function resolve(deps: ImportDeps): Promise<Resolved> {
	const { keychain } = deps;
	if (!(await keychain.isAvailable())) stop(MESSAGES.keychainUnavailable);
	// 使えると確かめた後の読み出しの失敗も、keychainを使えない場合と同じ終端とする。
	const read = (account: string) =>
		keychain.get(account).catch(() => stop(MESSAGES.keychainUnavailable));
	const settingsEnv = await readSettingsEnv(deps);
	const setting = (name: string) => deps.env[name] || settingsEnv[name];

	const workspaceId =
		setting("HARNESSFORCE_WORKSPACE_ID") ?? stop(MESSAGES.runInit);
	const ingestKey =
		(await read(ingestKeyAccount(workspaceId))) ?? stop(MESSAGES.runInit);
	const rawEndpoint =
		setting("HARNESSFORCE_ENDPOINT") ?? stop(MESSAGES.runInit);
	const endpoint = parseAllowedUrl(rawEndpoint) ?? stop(MESSAGES.invalidUrl);
	// hookが拒否する送信先へ、hookと同じ利用者用のkeyを送らない。
	const pinnedOrigin = await read(ingestOriginAccount(workspaceId));
	if (pinnedOrigin !== endpoint.origin) stop(MESSAGES.runInit);
	const apiToken =
		(await read(apiTokenAccount(workspaceId))) ?? stop(MESSAGES.runInit);
	const readBase =
		parseAllowedUrl(setting("HARNESSFORCE_URL") ?? deps.defaultUrl) ??
		stop(MESSAGES.invalidUrl);
	// Claude Codeの中から起動するとrepositoryのsettingsがHARNESSFORCE_URLを書き換えうるため、
	// hf initが使った接続先のoriginへだけApiTokenを送る。
	const pinnedUrlOrigin = await read(urlOriginAccount(workspaceId));
	if (pinnedUrlOrigin !== readBase.origin) stop(MESSAGES.runInit);
	return {
		destination: { workspaceId, endpoint: withoutExtras(endpoint) },
		endpoint,
		ingestKey,
		apiToken,
		readBase,
	};
}

function unwrap<T>(outcome: ReadOutcome<T>): T {
	if (outcome.kind === "ok") return outcome.value;
	return stop(
		outcome.kind === "unauthorized" ? MESSAGES.runInit : MESSAGES.readFailed,
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
	const resolved = await resolve(deps);
	const connected = unwrap(
		await listConnectedRepositories(
			resolved.readBase,
			resolved.apiToken,
			deps.fetch,
		),
	);
	const days = unwrap(
		await fetchSessionImportDays(
			resolved.readBase,
			resolved.apiToken,
			deps.fetch,
		),
	);
	const settingsDir = dirname(userSettingsPath(deps.env, deps.homeDir));
	const scan = await scanSessions({
		projectsDir: join(settingsDir, "projects"),
		sinceMs: deps.now() - days * DAY_MS,
		connected,
		git: deps.git,
	});
	if (scan.skippedLines > 0 || scan.skippedFiles > 0)
		deps.stdout(
			`読めなかった${scan.skippedLines}行と${scan.skippedFiles}個のfileを読み飛ばしました\n`,
		);
	const statePath = importStatePath(deps.homeDir);
	const sent = await readSentSessions(statePath, resolved.destination);
	const result = await sendSessions({
		endpoint: resolved.endpoint,
		ingestKey: resolved.ingestKey,
		sessions: scan.sessions.filter((s) => !sent.has(s.session_id)),
		fetch: deps.fetch,
		sleep: deps.sleep,
		record: (ids) =>
			recordSentSessions(statePath, resolved.destination, ids).catch(() =>
				stop(MESSAGES.stateFailed),
			),
	});
	return report(result, deps);
}

// correlation.md「session import」の`hf import`。
export async function importCommand(deps: ImportDeps): Promise<number> {
	try {
		return await runImport(deps);
	} catch (error) {
		if (!(error instanceof ImportStop)) throw error;
		deps.stderr(`${error.message}\n`);
		return 1;
	}
}
