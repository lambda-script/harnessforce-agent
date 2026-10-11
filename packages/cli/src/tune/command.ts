import { access } from "node:fs/promises";
import { join } from "node:path";
import type { RunGit } from "@harnessforce/agent-core/process/git";
import type { Env, Fetch } from "@harnessforce/agent-core/types";
import { withoutExtras } from "@harnessforce/agent-core/url";
import type { AnalysisReport } from "@harnessforce/semconv";
import { type CliAccess, verifyCliAccess } from "../credentials/access.js";
import { createApiTokenSession } from "../credentials/api-token-session.js";
import type { Keychain } from "../credentials/keychain.js";
import {
	fetchSessionImportDays,
	listConnectedRepositories,
} from "../import/read-api.js";
import { readTrustedEnv } from "../import/record-base.js";
import { sendSessions } from "../import/send.js";
import { toSessionImport } from "../import/sessions.js";
import {
	importStatePath,
	readSentSessions,
	recordSentSessions,
} from "../import/state.js";
import { PARSER_VERSION } from "../import/transcript.js";
import { runUntilStop, stopWith } from "../shared/stop.js";
import { ANALYZER_VERSION, analyzeSession } from "./analyze.js";
import { detectApplied } from "./applied.js";
import { collectMcpServers, type SnapshotDeps } from "./config-snapshot.js";
import { localIso, renderAnalysis } from "./display.js";
import { computeFollowups } from "./followups.js";
import { acquireTuneLock } from "./lock.js";
import { mcpConfigOf } from "./mcp-config.js";
import { MINIMUM_SESSIONS, Notices, TUNE_MESSAGES } from "./messages.js";
import {
	type AttributionSession,
	countProposals,
	decideAttribution,
	type ProposalRecord,
	readProposals,
	writeProposals,
} from "./proposals.js";
import {
	deleteSavedList,
	readSavedList,
	readSessionConfigs,
	readUnsent,
	type SavedList,
	type SessionConfig,
	type UnsentReport,
	writeSavedList,
	writeSessionConfigs,
	writeUnsent,
} from "./saved-state.js";
import { sendReports } from "./send.js";
import { readTuneSessions, type TuneSession } from "./sessions.js";
import { readSendSetting } from "./settings.js";
import {
	type Destination,
	ensureDir,
	type TunePaths,
	tunePaths,
	writeJsonFile,
} from "./store.js";

export type AnalyzeOptions = {
	all: boolean;
	noSend: boolean;
	showReport: boolean;
	json: boolean;
};

export type TuneDeps = {
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
// improvement-loop.md「読むもの」: Claude Codeが記録を既定で30日保存するため。
const DEFAULT_RANGE_DAYS = 30;
// 「文言と終了コード」: records_skippedの合計が読んだ行の5%を超えたら表示する。
const SKIPPED_RATIO = 0.05;

const ACCESS_MESSAGES = {
	keychainUnavailable: TUNE_MESSAGES.keychainUnavailable,
	initRequired: TUNE_MESSAGES.initRequired,
	invalidUrl: TUNE_MESSAGES.invalidUrl,
	apiTokenMissing: TUNE_MESSAGES.initRequired,
};

// 分析する範囲の判定に使う一覧。`fetched`はこの実行で取得したもの。
type ListInUse = SavedList & { source: "fetched" | "saved" };

type Analyzed = {
	tune: TuneSession;
	sendable: boolean | null;
	report: AnalysisReport;
};

// improvement-loop.md「読むもの」: 一覧と`session_import_days`を取得し、取得できなければ保存した一覧を使う。
async function resolveList(
	access: CliAccess,
	destination: Destination,
	paths: TunePaths,
	deps: TuneDeps,
	notices: Notices,
): Promise<ListInUse | undefined> {
	const readFetch = createApiTokenSession({
		keychain: deps.keychain,
		workspaceId: access.workspaceId,
		readBase: access.readApiBase,
		fetch: deps.fetch,
		now: deps.now,
		sleep: deps.sleep,
		homeDir: deps.homeDir,
	}).authorizedFetch(deps.fetch);
	const repositories = await listConnectedRepositories(
		access.readApiBase,
		access.accessToken,
		readFetch,
	);
	const days =
		repositories.kind === "ok"
			? await fetchSessionImportDays(
					access.readApiBase,
					access.accessToken,
					readFetch,
				)
			: repositories;
	if (repositories.kind === "ok" && days.kind === "ok") {
		const list: SavedList = {
			repositories: repositories.value,
			sessionImportDays: days.value,
			fetchedAtMs: deps.now(),
		};
		await writeSavedList(paths.repositories, destination, list).catch(() =>
			notices.add("unwritable", TUNE_MESSAGES.unwritable, 1),
		);
		return { ...list, source: "fetched" };
	}
	// refreshできない401だけが、未送信の分と保存した一覧を削除する（403はネットワークの失敗と同じ）。
	if (repositories.kind === "unauthorized" || days.kind === "unauthorized") {
		await writeUnsent(paths.unsent, destination, []).catch(() => {});
		await deleteSavedList(paths.repositories, destination).catch(() => {});
		notices.add("noList", TUNE_MESSAGES.noList);
		notices.add("loginExpired", TUNE_MESSAGES.loginExpired, 3);
		return undefined;
	}
	const saved = await readSavedList(paths.repositories, destination);
	if (!saved) {
		notices.add("noList", TUNE_MESSAGES.noList);
		return undefined;
	}
	notices.add(
		"savedList",
		TUNE_MESSAGES.savedList(localIso(saved.fetchedAtMs)),
	);
	return { ...saved, source: "saved" };
}

// improvement-loop.md「提案の件数の帰属」: 一覧を得た実行で、帰属を決めていない提案の帰属を決める。
function resolvePendingAttributions(
	proposals: readonly ProposalRecord[],
	sessions: ReadonlyMap<string, AttributionSession>,
): ProposalRecord[] {
	return proposals.map((proposal) => {
		if (proposal.attribution !== "pending") return proposal;
		const decided = decideAttribution(proposal.evidence_session_ids, sessions);
		return decided.attribution === "pending"
			? proposal
			: {
					...proposal,
					attribution: "decided",
					attributed_session_id: decided.sessionId,
				};
	});
}

const exists = (path: string) =>
	access(path).then(
		() => true,
		() => false,
	);

// improvement-loop.md「MCP server」: sessionを初めて分析したときの構成を保存し、以後はそれを使う。
async function sessionConfigsFor(
	sessions: readonly TuneSession[],
	paths: TunePaths,
	snapshot: SnapshotDeps,
	git: RunGit,
): Promise<{
	configs: Map<string, SessionConfig>;
	servers: Map<string, string[]>;
}> {
	const saved = await readSessionConfigs(paths.sessionConfigs);
	const configs = new Map<string, SessionConfig>();
	for (const [id, config] of saved)
		if (await exists(config.transcriptPath)) configs.set(id, config);
	const byCwd = new Map<string, Promise<string[] | undefined>>();
	const servers = new Map<string, string[]>();
	for (const { session, transcriptPath } of sessions) {
		const known = configs.get(session.sessionId);
		if (known) {
			servers.set(session.sessionId, known.servers);
			continue;
		}
		const cwd = session.cwd;
		const collected = cwd
			? await (byCwd.get(cwd) ??
					(() => {
						const pending = collectMcpServers(cwd, git, snapshot);
						byCwd.set(cwd, pending);
						return pending;
					})())
			: [];
		// 1秒を超えた収集は保存せず、この実行では`mcp_server`の無い一覧として扱う。
		servers.set(session.sessionId, collected ?? []);
		if (collected !== undefined)
			configs.set(session.sessionId, { servers: collected, transcriptPath });
	}
	return { configs, servers };
}

// improvement-loop.md「送信」: 送る前に、Runの無いsessionをharnessforce importと同じ規則で取り込む。
// 401を受けたらtrueを返し、分析結果を送らない。
async function importBeforeSending(
	sessions: readonly TuneSession[],
	list: ListInUse,
	access: CliAccess,
	destination: Destination,
	deps: TuneDeps,
	notices: Notices,
): Promise<boolean> {
	const statePath = importStatePath(deps.homeDir);
	const sinceMs = deps.now() - list.sessionImportDays * DAY_MS;
	const sent = await readSentSessions(statePath, destination);
	const targets = sessions
		.filter(
			(s) =>
				s.repository !== null &&
				list.repositories.has(s.repository) &&
				Date.parse(s.session.endedAt) >= sinceMs &&
				!sent.has(s.session.sessionId),
		)
		.map((s) => toSessionImport(s.session, s.repository as string));
	try {
		const result = await sendSessions({
			endpoint: access.ingest,
			ingestKey: access.ingestKey,
			sessions: targets,
			fetch: deps.fetch,
			sleep: deps.sleep,
			record: (ids) => recordSentSessions(statePath, destination, ids),
		});
		if (result.kind === "unauthorized") return true;
		if (result.kind === "limited")
			notices.add(
				"importLimited",
				TUNE_MESSAGES.importLimited(result.notImported),
			);
		if (result.kind === "failed")
			notices.add("importFailed", TUNE_MESSAGES.importFailed);
	} catch {
		notices.add("importFailed", TUNE_MESSAGES.importFailed);
	}
	return false;
}

const reportKey = (report: AnalysisReport) =>
	`${report.session_id} ${report.analyzer_version}`;

// improvement-loop.md「送信」の失敗の扱い。未送信の分はunsent.jsonに残し、次の実行で送る。
async function sendAnalysis(
	analyzed: readonly Analyzed[],
	list: ListInUse,
	access: CliAccess,
	destination: Destination,
	paths: TunePaths,
	deps: TuneDeps,
	notices: Notices,
): Promise<void> {
	const fresh: UnsentReport[] = analyzed
		.filter((a) => a.sendable === true)
		.map((a) => ({
			report: a.report,
			repository: a.tune.repository as string,
		}));
	const freshKeys = new Set(fresh.map((f) => reportKey(f.report)));
	const sinceMs = deps.now() - list.sessionImportDays * DAY_MS;
	const unsent = (await readUnsent(paths.unsent, destination)).filter(
		(u) => !freshKeys.has(reportKey(u.report)),
	);
	const inRange = unsent.filter(
		(u) => Date.parse(u.report.started_at) >= sinceMs,
	);
	if (inRange.length < unsent.length)
		notices.add(
			"expiredUnsent",
			TUNE_MESSAGES.expiredUnsent(unsent.length - inRange.length),
		);
	// 接続を外したrepositoryの分は送らずに残し、範囲を出たときに削除する。
	const held = inRange.filter((u) => !list.repositories.has(u.repository));
	const pending = [
		...inRange.filter((u) => list.repositories.has(u.repository)),
		...fresh,
	];
	const repositoryOf = new Map(
		pending.map((p) => [reportKey(p.report), p.repository]),
	);
	const result = await sendReports({
		endpoint: access.ingest,
		ingestKey: access.ingestKey,
		reports: pending.map((p) => p.report),
		fetch: deps.fetch,
	});
	const keep = [
		...(result.unusableKey === undefined ? held : []),
		...result.keep.map((report) => ({
			report,
			repository: repositoryOf.get(reportKey(report)) as string,
		})),
	];
	const isSaved = await writeUnsent(paths.unsent, destination, keep).then(
		() => true,
		() => false,
	);
	if (!isSaved) notices.add("unwritable", TUNE_MESSAGES.unwritable, 1);
	if (result.accepted > 0)
		notices.add("sent", TUNE_MESSAGES.sent(result.accepted));
	// 残せなかった分を「次の実行で送ります」と表示しない。
	if (isSaved && result.unreachable > 0)
		notices.add("unreachable", TUNE_MESSAGES.unreachable(result.unreachable));
	if (isSaved && result.readOnly > 0)
		notices.add("readOnly", TUNE_MESSAGES.readOnly(result.readOnly));
	if (result.invalid.count > 0)
		notices.add(
			"invalidReports",
			TUNE_MESSAGES.invalidReports(
				result.invalid.count,
				result.invalid.reasons,
			),
		);
	const [lastRejected] = result.rejected.slice(-1);
	if (lastRejected)
		notices.add(
			"rejected",
			TUNE_MESSAGES.rejected(
				lastRejected.status,
				result.rejected.reduce((sum, r) => sum + r.count, 0),
			),
		);
	if (result.unusableKey !== undefined)
		notices.add(
			"keyUnusable",
			TUNE_MESSAGES.keyUnusable(result.unusableKey + held.length),
			3,
		);
}

async function analyzeUnderLock(
	options: AnalyzeOptions,
	access: CliAccess,
	paths: TunePaths,
	deps: TuneDeps,
): Promise<number> {
	const notices = new Notices();
	const destination: Destination = {
		workspaceId: access.workspaceId,
		endpoint: withoutExtras(access.ingest),
	};
	const setting = options.noSend
		? "no_send"
		: await readSendSetting(deps.homeDir);
	let list: ListInUse | undefined;
	if (setting === "send") {
		list = await resolveList(access, destination, paths, deps, notices);
	} else {
		notices.add(
			setting === "no_send" ? "noSend" : "settingUnreadable",
			setting === "no_send"
				? TUNE_MESSAGES.noSend
				: TUNE_MESSAGES.settingUnreadable,
		);
		const saved = await readSavedList(paths.repositories, destination);
		list = saved && { ...saved, source: "saved" };
	}

	const nowMs = deps.now();
	const rangeSinceMs = nowMs - DEFAULT_RANGE_DAYS * DAY_MS;
	const isLimited = !options.all && list !== undefined;
	const trustedEnv = await readTrustedEnv(deps, [
		"CLAUDE_CONFIG_DIR",
		"CLAUDE_CODE_PLUGIN_CACHE_DIR",
	]);
	const configDir =
		trustedEnv.CLAUDE_CONFIG_DIR ?? join(deps.homeDir, ".claude");
	const all = await readTuneSessions({
		projectsDir: join(configDir, "projects"),
		modifiedSinceMs: isLimited ? rangeSinceMs : undefined,
		git: deps.git,
	});
	const connected = (s: TuneSession) =>
		list !== undefined &&
		s.repository !== null &&
		list.repositories.has(s.repository);
	const inScope = isLimited
		? all.filter(
				(s) => Date.parse(s.session.startedAt) >= rangeSinceMs && connected(s),
			)
		: all;
	const sendSinceMs = list
		? nowMs - list.sessionImportDays * DAY_MS
		: undefined;
	const sendableOf = (s: TuneSession): boolean | null =>
		sendSinceMs === undefined
			? null
			: connected(s) && Date.parse(s.session.startedAt) >= sendSinceMs;

	const attributionSessions = new Map<string, AttributionSession>(
		inScope.map((s) => [
			s.session.sessionId,
			{
				sessionId: s.session.sessionId,
				startedAt: s.session.startedAt,
				sendable: sendableOf(s),
			},
		]),
	);
	const snapshot: SnapshotDeps = {
		homeDir: deps.homeDir,
		managedDir: deps.managedDir,
		env: trustedEnv,
		now: deps.now,
	};
	const detected = await detectApplied(
		list
			? resolvePendingAttributions(
					await readProposals(paths.proposals),
					attributionSessions,
				)
			: await readProposals(paths.proposals),
		snapshot,
	);
	const { configs, servers } = await sessionConfigsFor(
		inScope,
		paths,
		snapshot,
		deps.git,
	);
	const analyzed: Analyzed[] = inScope.map((tune) => ({
		tune,
		sendable: sendableOf(tune),
		report: analyzeSession({
			session: tune.session,
			events: tune.events,
			skippedLines: tune.skippedLines,
			mcp: mcpConfigOf(servers.get(tune.session.sessionId) ?? []),
			proposals: countProposals(detected, tune.session.sessionId),
		}),
	}));

	const { followups, ended } = computeFollowups(
		detected,
		analyzed.map((a) => ({
			startedAt: a.tune.session.startedAt,
			report: a.report,
			usage: a.tune.usage,
		})),
		nowMs,
		isLimited ? rangeSinceMs : undefined,
	);
	// 「前回の提案の前後」: 後の期間が満了した要素を出力した`--json`の実行だけが、その時刻を記録する。
	const outputEnded = new Set(options.json ? ended : []);
	const proposals = detected.map((p) =>
		outputEnded.has(p.proposal_id)
			? { ...p, followup_output_at: new Date(nowMs).toISOString() }
			: p,
	);

	const output = {
		analyzer_version: ANALYZER_VERSION,
		parser_version: PARSER_VERSION,
		session_count: analyzed.length,
		sufficient: analyzed.length >= MINIMUM_SESSIONS,
		repositories_fetched_at: list
			? new Date(list.fetchedAtMs).toISOString()
			: null,
		sessions: analyzed.map((a) => ({
			session_id: a.tune.session.sessionId,
			started_at: a.tune.session.startedAt,
			transcript_path: a.tune.transcriptPath,
			repository: a.tune.repository,
			sendable: a.sendable,
			report: a.report,
			usage: a.tune.usage,
		})),
		followups,
	};
	const isWritten = await Promise.all([
		writeJsonFile(paths.analysis, { version: 1, sessions: output.sessions }),
		writeProposals(paths.proposals, proposals),
		writeSessionConfigs(paths.sessionConfigs, configs),
	]).then(
		() => true,
		() => false,
	);
	if (!isWritten) notices.add("unwritable", TUNE_MESSAGES.unwritable, 1);

	if (options.json) deps.stdout(`${JSON.stringify(output)}\n`);
	else {
		deps.stdout(
			renderAnalysis(
				analyzed.map((a) => a.report),
				analyzed.map((a) => a.tune.usage),
				{
					sessionCount: analyzed.length,
					analyzerVersion: ANALYZER_VERSION,
					parserVersion: PARSER_VERSION,
				},
			),
		);
		if (options.showReport)
			deps.stdout(
				`${JSON.stringify(
					analyzed.filter((a) => a.sendable === true).map((a) => a.report),
					null,
					2,
				)}\n`,
			);
	}

	if (analyzed.length < MINIMUM_SESSIONS)
		notices.add("insufficient", TUNE_MESSAGES.insufficient(analyzed.length));
	const lines = analyzed.reduce((sum, a) => sum + a.tune.lines, 0);
	const skipped = analyzed.reduce((sum, a) => sum + a.tune.skippedLines, 0);
	if (skipped > lines * SKIPPED_RATIO)
		notices.add(
			"partlyUnreadable",
			TUNE_MESSAGES.partlyUnreadable(lines, skipped),
		);

	if (setting === "send" && list !== undefined) {
		const outOfRange = analyzed.filter(
			(a) => connected(a.tune) && !a.sendable,
		).length;
		if (outOfRange > 0)
			notices.add(
				"outOfRange",
				TUNE_MESSAGES.outOfRange(list.sessionImportDays, outOfRange),
			);
		const notConnectedCount = analyzed.filter((a) => !connected(a.tune)).length;
		if (options.all && notConnectedCount > 0)
			notices.add(
				"notConnected",
				TUNE_MESSAGES.notConnected(notConnectedCount),
			);
		if (isWritten && !notices.has("unwritable")) {
			const isUnauthorized =
				list.source === "fetched" &&
				(await importBeforeSending(
					all,
					list,
					access,
					destination,
					deps,
					notices,
				));
			if (isUnauthorized) {
				const keys = new Set([
					...(await readUnsent(paths.unsent, destination)).map((u) =>
						reportKey(u.report),
					),
					...analyzed
						.filter((a) => a.sendable === true)
						.map((a) => reportKey(a.report)),
				]);
				const count = keys.size;
				await writeUnsent(paths.unsent, destination, []).catch(() => {});
				notices.add("keyUnusable", TUNE_MESSAGES.keyUnusable(count), 3);
			} else
				await sendAnalysis(
					analyzed,
					list,
					access,
					destination,
					paths,
					deps,
					notices,
				);
		}
	}
	return notices.flush(deps.stderr);
}

// improvement-loop.md「`harnessforce tune`」の分析を行う呼び出し。
export function analyzeCommand(
	options: AnalyzeOptions,
	deps: TuneDeps,
): Promise<number> {
	return runUntilStop(async () => {
		const access = await verifyCliAccess(deps, ACCESS_MESSAGES);
		const paths = tunePaths(deps.homeDir);
		await ensureDir(paths.dir).catch(() => stopWith(TUNE_MESSAGES.unwritable));
		const release = await acquireTuneLock(paths.lock, deps).catch(() =>
			stopWith(TUNE_MESSAGES.unwritable),
		);
		if (!release) return stopWith(TUNE_MESSAGES.locked);
		try {
			return await analyzeUnderLock(options, access, paths, deps);
		} finally {
			await release();
		}
	}, deps.stderr);
}
