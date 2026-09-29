import { isObject } from "@harnessforce/agent-core/object";
import type { AnalysisReport } from "@harnessforce/semconv";
import {
	type Destination,
	destinationKey,
	readJsonFile,
	writeJsonFile,
} from "./store.js";

// `repositories.json`の1つの送信先の値。
export type SavedList = {
	repositories: Set<string>;
	sessionImportDays: number;
	fetchedAtMs: number;
};

type Destinations<T> = Record<string, T>;

async function readDestinations(path: string): Promise<Destinations<unknown>> {
	const value = await readJsonFile(path);
	return isObject(value) && isObject(value.destinations)
		? value.destinations
		: {};
}

async function writeDestination(
	path: string,
	destination: Destination,
	entry: unknown,
): Promise<void> {
	const { [destinationKey(destination)]: _, ...others } =
		await readDestinations(path);
	await writeJsonFile(path, {
		version: 1,
		destinations:
			entry === undefined
				? others
				: { ...others, [destinationKey(destination)]: entry },
	});
}

// 別のWorkspaceや環境の一覧は、保存した一覧が無いものとして扱う。
export async function readSavedList(
	path: string,
	destination: Destination,
): Promise<SavedList | undefined> {
	const entry = (await readDestinations(path))[destinationKey(destination)];
	if (!isObject(entry)) return undefined;
	const {
		repositories,
		session_import_days: days,
		fetched_at: fetchedAt,
	} = entry;
	const fetchedAtMs =
		typeof fetchedAt === "string" ? Date.parse(fetchedAt) : NaN;
	if (
		!Array.isArray(repositories) ||
		!repositories.every((r) => typeof r === "string") ||
		typeof days !== "number" ||
		!Number.isSafeInteger(days) ||
		days < 1 ||
		Number.isNaN(fetchedAtMs)
	)
		return undefined;
	return {
		repositories: new Set(repositories as string[]),
		sessionImportDays: days,
		fetchedAtMs,
	};
}

export const writeSavedList = (
	path: string,
	destination: Destination,
	list: SavedList,
) =>
	writeDestination(path, destination, {
		repositories: [...list.repositories].sort(),
		session_import_days: list.sessionImportDays,
		fetched_at: new Date(list.fetchedAtMs).toISOString(),
	});

export const deleteSavedList = (path: string, destination: Destination) =>
	writeDestination(path, destination, undefined);

// `unsent.json`: 送信先ごとの未送信のanalysis reportと、そのsessionのrepository。
// 送る前に接続済みの一覧で絞るため、repositoryも持つ。
export type UnsentReport = { report: AnalysisReport; repository: string };

export async function readUnsent(
	path: string,
	destination: Destination,
): Promise<UnsentReport[]> {
	const entry = (await readDestinations(path))[destinationKey(destination)];
	if (!isObject(entry) || !Array.isArray(entry.reports)) return [];
	return entry.reports.filter(
		(item): item is UnsentReport =>
			isObject(item) &&
			isObject(item.report) &&
			typeof item.report.session_id === "string" &&
			typeof item.report.analyzer_version === "string" &&
			typeof item.report.started_at === "string" &&
			typeof item.repository === "string",
	);
}

export const writeUnsent = (
	path: string,
	destination: Destination,
	reports: readonly UnsentReport[],
) =>
	writeDestination(
		path,
		destination,
		reports.length === 0 ? undefined : { reports },
	);

// `session-configs.json`: sessionを初めて分析したときに保存した`mcp_server`の識別子と、その記録のfile。
export type SessionConfig = { servers: string[]; transcriptPath: string };

export async function readSessionConfigs(
	path: string,
): Promise<Map<string, SessionConfig>> {
	const value = await readJsonFile(path);
	const sessions =
		isObject(value) && isObject(value.sessions) ? value.sessions : {};
	const configs = new Map<string, SessionConfig>();
	for (const [id, entry] of Object.entries(sessions)) {
		if (
			!isObject(entry) ||
			!Array.isArray(entry.servers) ||
			!entry.servers.every((server) => typeof server === "string") ||
			typeof entry.transcript_path !== "string"
		)
			continue;
		configs.set(id, {
			servers: entry.servers as string[],
			transcriptPath: entry.transcript_path,
		});
	}
	return configs;
}

export const writeSessionConfigs = (
	path: string,
	configs: ReadonlyMap<string, SessionConfig>,
) =>
	writeJsonFile(path, {
		version: 1,
		sessions: Object.fromEntries(
			[...configs].map(([id, config]) => [
				id,
				{ servers: config.servers, transcript_path: config.transcriptPath },
			]),
		),
	});
