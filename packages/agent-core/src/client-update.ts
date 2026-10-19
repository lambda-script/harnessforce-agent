import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isObject } from "./object.js";
import type { Env, Fetch } from "./types.js";
import { underBase } from "./url.js";

// client-updates.md: clientの版の申告と、serverが返す更新の状態の保存と表示。

export type ClientComponent = "cli" | "claude-code-plugin";
// devは接続先を与えたbuild（npmへ配らない）。serverはその`User-Agent`を判定しない。
export type ClientIdentity = {
	component: ClientComponent;
	version: string;
	dev: boolean;
};

export type UpdateStatus =
	| "current"
	| "outdated"
	| "deprecated"
	| "unsupported";
export type UpdateReason = "security" | "compatibility";
export type ClientUpdate = {
	status: UpdateStatus;
	latest?: string;
	reason?: UpdateReason;
	// 効力の開始（UTCの00:00の瞬間）のISO 8601。
	deadline?: string;
};
export type UpdateState = ClientUpdate & {
	version: string;
	receivedAt: string;
	outdatedShownAt?: string;
};

export const CLIENT_UPDATE_HEADER = "harnessforce-client-update";

const UPDATE_COMMANDS: Record<ClientComponent, string> = {
	cli: "npm install -g @harnessforce/cli@latest",
	"claude-code-plugin": "claude plugin update harnessforce@harnessforce-agent",
};
const DISPLAY_NAMES: Record<ClientComponent, string> = {
	cli: "CLI",
	"claude-code-plugin": "plugin",
};
const DAY_MS = 24 * 60 * 60 * 1000;
// recheckの上限時間。hookの送信の上限時間と揃える。
const RECHECK_TIMEOUT_MS = 2000;

export const userAgentOf = (client: ClientIdentity): string =>
	`harnessforce-${client.component}${client.dev ? "-dev" : ""}/${client.version}`;

const STATUSES = new Set<string>([
	"current",
	"outdated",
	"deprecated",
	"unsupported",
]);
const REASONS = new Set<string>(["security", "compatibility"]);

// RFC 9651のDictionaryのうち、serverが使うToken、String、Dateだけを読む。形に合わない値は無いものとする。
export function parseClientUpdateHeader(
	value: string | null,
): ClientUpdate | undefined {
	if (!value) return undefined;
	const members = new Map<string, string>();
	for (const member of value.split(",")) {
		const [key, raw] = member.trim().split("=", 2);
		if (key && raw !== undefined) members.set(key, raw);
	}
	const status = members.get("status");
	if (!status || !STATUSES.has(status)) return undefined;
	const update: ClientUpdate = { status: status as UpdateStatus };
	const latest = /^"([^"\\]*)"$/.exec(members.get("latest") ?? "")?.[1];
	if (latest) update.latest = latest;
	const reason = members.get("reason");
	if (reason && REASONS.has(reason)) update.reason = reason as UpdateReason;
	const seconds = /^@(\d+)$/.exec(members.get("deadline") ?? "")?.[1];
	if (seconds) update.deadline = new Date(Number(seconds) * 1000).toISOString();
	if ((status === "deprecated" || status === "unsupported") && !update.reason)
		return undefined;
	if (status === "deprecated" && !update.deadline) return undefined;
	return update;
}

function stateFrom(value: unknown, version: string): UpdateState | undefined {
	if (!isObject(value) || value.version !== version) return undefined;
	if (typeof value.receivedAt !== "string") return undefined;
	if (typeof value.status !== "string" || !STATUSES.has(value.status))
		return undefined;
	return value as UpdateState;
}

// 更新の後（fileの版が自身の版と異なる）と読めないfileは、状態が無いものとして扱う。
export async function readUpdateState(
	path: string,
	version: string,
): Promise<UpdateState | undefined> {
	const saved = await readSavedUpdateState(path);
	return saved?.version === version ? saved : undefined;
}

// 版を問わずに読む。pluginのhookが、版を知らないCLIの状態を確かめ直すときに使う。
export async function readSavedUpdateState(
	path: string,
): Promise<UpdateState | undefined> {
	try {
		const value: unknown = JSON.parse(await readFile(path, "utf8"));
		return isObject(value) && typeof value.version === "string"
			? stateFrom(value, value.version)
			: undefined;
	} catch {
		return undefined;
	}
}

// 同じdirectoryの一時fileへ書いてからrenameで置き換える。~/.harnessforce/の他のfileと同じく0600とする。
export async function writeUpdateState(
	path: string,
	state: UpdateState,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
	await rename(temporary, path);
}

/**
 * Harnessforceへの要求に`User-Agent`を付け、応答の`Harnessforce-Client-Update`を状態のfileへ保存するfetch。
 * 保存に失敗しても要求の結果は変えない。statePathが無い（pluginのdata directoryが無い）場合は版の申告だけを行う。
 */
export function recordingFetch(
	fetchImpl: Fetch,
	client: ClientIdentity,
	statePath: string | undefined,
	now: () => Date,
): Fetch {
	return async (url, init) => {
		// headerはplainなobjectのまま渡す。呼び出し側と同じ形を保つためである。
		const headers = {
			...Object.fromEntries(new Headers(init.headers)),
			"user-agent": userAgentOf(client),
		};
		const response = await fetchImpl(url, { ...init, headers });
		const update = parseClientUpdateHeader(
			response.headers.get(CLIENT_UPDATE_HEADER),
		);
		if (update && statePath) {
			const previous = await readUpdateState(statePath, client.version);
			await writeUpdateState(statePath, {
				...update,
				version: client.version,
				receivedAt: now().toISOString(),
				...(previous?.outdatedShownAt
					? { outdatedShownAt: previous.outdatedShownAt }
					: {}),
			}).catch(() => {});
		}
		return response;
	};
}

// 表示の暦日はUTCで決める。効力の開始はUTCの00:00に限るため、示した日の始まりから止まる。
const utcDate = (instant: string) =>
	new Intl.DateTimeFormat("en-CA", {
		timeZone: "UTC",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date(instant));

// client-updates.md「表示」の文言。currentでは何も表示しない。
export function updateLine(
	component: ClientComponent,
	update: ClientUpdate,
): string | undefined {
	const name = DISPLAY_NAMES[component];
	const command = UPDATE_COMMANDS[component];
	switch (update.status) {
		case "unsupported":
			return `This Harnessforce ${name} version is no longer supported, so nothing is being sent to Harnessforce. Update it: \`${command}\``;
		case "deprecated": {
			const stops = `stops sending on ${utcDate(update.deadline ?? "")} (00:00 UTC)`;
			return update.reason === "security"
				? `A security update for Harnessforce ${name} is available. This version ${stops}. Update it: \`${command}\``
				: `This Harnessforce ${name} version ${stops}. Update it: \`${command}\``;
		}
		case "outdated":
			return `Harnessforce ${name} ${update.latest} is available. Update it: \`${command}\``;
		default:
			return undefined;
	}
}

// outdatedは24時間に1回まで。update-notifierと同じく、NO_UPDATE_NOTIFIERとCIの中では示さない。
export function shouldShowOutdated(
	state: UpdateState,
	now: Date,
	env: Env,
): boolean {
	if (state.status !== "outdated" || env.NO_UPDATE_NOTIFIER || env.CI)
		return false;
	const shownAt = state.outdatedShownAt
		? Date.parse(state.outdatedShownAt)
		: Number.NaN;
	return Number.isNaN(shownAt) || now.getTime() - shownAt >= DAY_MS;
}

export const markOutdatedShown = (
	path: string,
	state: UpdateState,
	now: Date,
): Promise<void> =>
	writeUpdateState(path, { ...state, outdatedShownAt: now.toISOString() });

type RecheckOptions = {
	state: UpdateState | undefined;
	ingestBase: URL;
	// recordingFetchで包んだfetch。受けた状態は包んだ側が状態のfileへ書く。
	fetch: Fetch;
	statePath: string;
	version: string;
	now: () => Date;
};

/**
 * unsupportedを受けてから24時間以上経っていれば、資格情報を送らずに`GET /v1/client-status`で確かめ直す
 * （client-updates.md「送信の停止」）。失敗した場合は状態を変えない。
 */
export async function recheckClientStatus(
	options: RecheckOptions,
): Promise<UpdateState | undefined> {
	const { state } = options;
	if (
		state?.status !== "unsupported" ||
		options.now().getTime() - Date.parse(state.receivedAt) < DAY_MS
	)
		return state;
	try {
		const response = await options.fetch(
			underBase(options.ingestBase, "v1/client-status"),
			{
				method: "GET",
				redirect: "error",
				signal: AbortSignal.timeout(RECHECK_TIMEOUT_MS),
			},
		);
		await response.body?.cancel();
	} catch {
		return state;
	}
	return (await readUpdateState(options.statePath, options.version)) ?? state;
}
