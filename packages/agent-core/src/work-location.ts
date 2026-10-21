import {
	lstat,
	mkdir,
	readFile,
	rename,
	stat,
	writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
	MAX_WORK_LOCATIONS,
	type SessionWorkLocation,
	type WorkLocationPair,
} from "@harnessforce/semconv";
import { type Destination, postItem, type SendOutcome } from "./ingest.js";
import { isObject } from "./object.js";
import type { RunGit } from "./process/git.js";
import type { Fetch } from "./types.js";
import { resolveVcs } from "./vcs.js";

// correlation.md「sessionの作業位置」。sessionが作業したworking treeのrepositoryとbranchを、観測した時点の値で記録する。

export type LocationAgent = SessionWorkLocation["agent"];
export type LocationEvent = "cwd-changed" | "post-tool-use" | "stop";

const absolute = (value: unknown) =>
	typeof value === "string" && isAbsolute(value) ? value : undefined;

const toolInputOf = (fields: Record<string, unknown>) =>
	isObject(fields.tool_input) ? fields.tool_input : {};

// apply_patchの文法（agent-telemetry.md「作業位置に使うhook」）。変更の行は`+`、`-`、空白で始まるため、この行に当たらない。
const PATCH_FILE_LINE =
	/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/;

function patchedDirectories(command: unknown, cwd: string): string[] {
	if (typeof command !== "string") return [];
	return command.split(/\r?\n/).flatMap((line) => {
		const path = PATCH_FILE_LINE.exec(line)?.[1]?.trim();
		return path ? [dirname(resolve(cwd, path))] : [];
	});
}

/**
 * eventの入力から、作業位置を求めるdirectoryを返す。読むのは`new_cwd`、`file_path`、patchのfileの行のpathだけで、編集の
 * 本文を読まない。
 */
export function observedDirectories(
	agent: LocationAgent,
	event: LocationEvent,
	fields: Record<string, unknown>,
	cwd: string,
): string[] {
	if (event === "stop") return [cwd];
	if (agent === "claude_code" && event === "cwd-changed") {
		const newCwd = absolute(fields.new_cwd);
		return newCwd ? [newCwd] : [];
	}
	if (event !== "post-tool-use") return [];
	const input = toolInputOf(fields);
	if (agent === "codex")
		return fields.tool_name === "apply_patch"
			? [...new Set(patchedDirectories(input.command, cwd))]
			: [];
	if (fields.tool_name !== "Write" && fields.tool_name !== "Edit") return [];
	const filePath = absolute(input.file_path);
	return filePath ? [dirname(filePath)] : [];
}

const isDirectory = (path: string) =>
	stat(path).then(
		(found) => found.isDirectory(),
		() => false,
	);

/** directoryのworking treeの、その時点のrepositoryとbranch。repositoryかbranchを求められなければundefined。 */
export async function observePair(
	directory: string,
	git: RunGit,
): Promise<WorkLocationPair | undefined> {
	if (!(await isDirectory(directory))) return undefined;
	const vcs = await resolveVcs(directory, git);
	return vcs?.repository && vcs.branch
		? { repository: vcs.repository, branch: vcs.branch }
		: undefined;
}

export type LocationState = {
	pairs: WorkLocationPair[];
	sent: WorkLocationPair[];
	// 作業位置の送信で401を受けた。以後このsessionでは送らない。
	unauthorized: boolean;
};

export const emptyLocationState = (): LocationState => ({
	pairs: [],
	sent: [],
	unauthorized: false,
});

const pairKey = (pair: WorkLocationPair) =>
	JSON.stringify([pair.repository, pair.branch]);

/** 組を加える。記録済みの組と、10件に達した後の組は加えない。 */
export function withObservedPair(
	state: LocationState,
	pair: WorkLocationPair,
): LocationState {
	const known = state.pairs.some((saved) => pairKey(saved) === pairKey(pair));
	if (known || state.pairs.length >= MAX_WORK_LOCATIONS) return state;
	return { ...state, pairs: [...state.pairs, pair] };
}

/** 記録した組の集合が、最後に送った集合と異なる場合だけ送る組。 */
export function locationsToSend(
	state: LocationState,
): WorkLocationPair[] | undefined {
	if (state.unauthorized || state.pairs.length === 0) return undefined;
	const sent = new Set(state.sent.map(pairKey));
	const isSame =
		sent.size === state.pairs.length &&
		state.pairs.every((pair) => sent.has(pairKey(pair)));
	return isSame ? undefined : state.pairs;
}

const isPair = (value: unknown): value is WorkLocationPair =>
	isObject(value) &&
	typeof value.repository === "string" &&
	typeof value.branch === "string";

// 読めない、壊れた記録は、記録が無い場合と同じに扱う。
export async function readLocationState(path: string): Promise<LocationState> {
	try {
		const saved: unknown = JSON.parse(await readFile(path, "utf8"));
		if (
			!isObject(saved) ||
			!Array.isArray(saved.pairs) ||
			!Array.isArray(saved.sent)
		)
			return emptyLocationState();
		return {
			pairs: saved.pairs.filter(isPair),
			sent: saved.sent.filter(isPair),
			unauthorized: saved.unauthorized === true,
		};
	} catch {
		return emptyLocationState();
	}
}

// 同じdirectoryの一時fileへ書いてからrenameで置き換える。並行した更新で1件の組が失われることは許容する。
export async function writeLocationState(
	path: string,
	state: LocationState,
): Promise<void> {
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
	await rename(temporary, path);
}

// fileの名前をdirectoryの外へ向けないため、これ以外のsession_idでは記録しない（correlation.md「hook」）。
const FILE_SAFE_SESSION_ID = /^[A-Za-z0-9_-]+$/;

const LOCATION_DIRECTORY = "harnessforce-locations";

// 他の利用者と共有されうる一時directoryで、他の利用者が用意したdirectoryへ書かない。
async function isPrivateDirectory(path: string): Promise<boolean> {
	const found = await lstat(path).catch(() => undefined);
	if (!found) return false;
	const uid = process.getuid?.();
	return (
		found.isDirectory() &&
		!found.isSymbolicLink() &&
		(uid === undefined || found.uid === uid) &&
		(found.mode & 0o777) === 0o700
	);
}

/**
 * Codexの記録のfile。Codexのhookは`scratchpad_dir`を受け取らないため、OSの一時directoryの下に置く。macOSとLinuxでは
 * directoryの所有者とmodeを確かめ、満たさなければundefinedを返す（記録も送信もしない）。Windowsの`TEMP`は利用者ごとに分かれる。
 */
export async function codexLocationStatePath(
	temporaryDirectory: string,
	sessionId: string,
	platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
	if (!FILE_SAFE_SESSION_ID.test(sessionId)) return undefined;
	const directory = join(temporaryDirectory, LOCATION_DIRECTORY);
	if (platform !== "win32") {
		await mkdir(directory, { mode: 0o700 }).catch(() => {});
		if (!(await isPrivateDirectory(directory))) return undefined;
	} else await mkdir(directory, { recursive: true }).catch(() => {});
	return join(directory, `codex-${sessionId}.json`);
}

/** Claude Codeの記録のfile。`scratchpad_dir`が無ければ記録も送信もしない。 */
export const claudeLocationStatePath = (
	scratchpadDir: string,
	sessionId: string,
) =>
	FILE_SAFE_SESSION_ID.test(sessionId)
		? join(scratchpadDir, `locations-${sessionId}.json`)
		: undefined;

export type LocationDeps = { git: RunGit };

/** 観測したdirectoryの組を記録のfileへ加える。gitの外のdirectoryは記録しない。 */
export async function recordObservedPairs(
	statePath: string,
	directories: readonly string[],
	deps: LocationDeps,
): Promise<LocationState> {
	const pairs = await Promise.all(
		directories.map((directory) => observePair(directory, deps.git)),
	);
	const before = await readLocationState(statePath);
	const after = pairs.reduce<LocationState>(
		(state, pair) => (pair ? withObservedPair(state, pair) : state),
		before,
	);
	if (after !== before) await writeLocationState(statePath, after);
	return after;
}

export type LocationSent =
	| { kind: "unchanged" }
	| { kind: "sent"; outcome: SendOutcome };

/**
 * 記録した組の集合が最後に送った集合と異なれば`/v1/sessions/locations`へ送る。2xxなら送った集合を記録し、401なら以後送らない
 * ことを記録する。それ以外の失敗では記録を変えず、次の`Stop`が送り直しを兼ねる。
 */
export async function sendLocations(
	statePath: string,
	state: LocationState,
	item: Readonly<{ agent: LocationAgent; sessionId: string }>,
	destination: Destination,
	fetchImpl: Fetch,
): Promise<LocationSent> {
	const locations = locationsToSend(state);
	if (!locations) return { kind: "unchanged" };
	const outcome = await postItem(
		destination,
		"v1/sessions/locations",
		{ agent: item.agent, session_id: item.sessionId, locations },
		fetchImpl,
	);
	if (outcome.kind === "accepted")
		await writeLocationState(statePath, { ...state, sent: locations });
	if (outcome.kind === "unauthorized")
		await writeLocationState(statePath, { ...state, unauthorized: true });
	return { kind: "sent", outcome };
}
