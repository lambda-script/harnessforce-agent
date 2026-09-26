import { randomUUID } from "node:crypto";
import {
	chmod,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { isObject } from "../config/files.js";

// correlation.md「session import」: 送り終えたsessionを、Workspaceとingestの送信先の組ごとに記録する。
// あるWorkspaceや環境へ送り終えたsessionも、別の組へは未送信として扱う。
export type Destination = { workspaceId: string; endpoint: string };

type State = {
	version: 1;
	destinations: Record<string, { sessions: string[] }>;
};

const STATE_VERSION = 1;
// session IDはsessionの記録の場所を示し、他の利用者に見せる必要が無いため、所有者だけが読めるようにする。
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export const importStatePath = (homeDir: string) =>
	join(homeDir, ".harnessforce", "import-state.json");

// Workspaceのidは空白を含まず、送信先はURLなので、空白で区切れば組が一意に決まる。
const keyOf = ({ workspaceId, endpoint }: Destination) =>
	`${workspaceId} ${endpoint}`;

const isSessionList = (value: unknown): value is { sessions: string[] } =>
	isObject(value) &&
	Array.isArray(value.sessions) &&
	value.sessions.every((id) => typeof id === "string");

// 読めない、または形の違うfileは、何も送っていないものとして扱う。送信はagentとsession IDで冪等なため、再送しても重複しない。
async function readState(path: string): Promise<State> {
	const empty: State = { version: STATE_VERSION, destinations: {} };
	try {
		const value: unknown = JSON.parse(await readFile(path, "utf8"));
		if (
			!isObject(value) ||
			value.version !== STATE_VERSION ||
			!isObject(value.destinations)
		)
			return empty;
		const destinations = Object.fromEntries(
			Object.entries(value.destinations).filter(([, entry]) =>
				isSessionList(entry),
			),
		) as State["destinations"];
		return { version: STATE_VERSION, destinations };
	} catch {
		return empty;
	}
}

export async function readSentSessions(
	path: string,
	destination: Destination,
): Promise<Set<string>> {
	const state = await readState(path);
	return new Set(state.destinations[keyOf(destination)]?.sessions);
}

// 途中まで書かれたfileを次の実行に読ませないよう、一時fileからrenameで置き換える。
export async function recordSentSessions(
	path: string,
	destination: Destination,
	sessionIds: readonly string[],
): Promise<void> {
	const state = await readState(path);
	const key = keyOf(destination);
	const sessions = [
		...new Set([...(state.destinations[key]?.sessions ?? []), ...sessionIds]),
	];
	const next: State = {
		...state,
		destinations: { ...state.destinations, [key]: { sessions } },
	};
	await mkdir(dirname(path), { recursive: true, mode: DIR_MODE });
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(next)}\n`, {
			mode: FILE_MODE,
			flag: "wx",
		});
		// umaskの影響を受けないよう、作った後に揃える。
		await chmod(temporary, FILE_MODE);
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}
