import type { Fetch } from "@harnessforce/agent-core/types";
import type { SessionUsageSummary } from "@harnessforce/semconv";
import {
	type Destination,
	postItems,
	type SendOutcome,
	workspaceIdOf,
} from "../destination.js";
import {
	listSessions,
	readRecord,
	readState,
	recordChangeOf,
	type UsageRecord,
	type UsageState,
	type UsageStore,
	writeSentLength,
} from "./store.js";
import { buildSummary } from "./summary.js";

type SendDeps = { fetch: Fetch; now: () => Date };

// correlation.md「送る契機」のSessionEnd: このsessionの記録から要約を作り、deadlineMsまでに送る。
// 2xxを受けたら送った記録の長さを書く。それ以外では書かず、次のsessionの開始で送る。
export async function sendSessionUsage(
	store: UsageStore,
	destination: Destination,
	deadlineMs: number,
	deps: SendDeps,
): Promise<SendOutcome | undefined> {
	const state = await readState(store);
	if (!state || state.workspaceId !== workspaceIdOf(destination.key))
		return undefined;
	const record = await readRecord(store);
	const summary = record
		? buildSummary(store.sessionId, record.lines)
		: undefined;
	if (!record || !summary) return undefined;
	const remainingMs = deadlineMs - deps.now().getTime();
	if (remainingMs <= 0) return { kind: "failed", reason: "TimeoutError" };
	const outcome = await postItems(
		destination,
		"v1/session-usage",
		[summary],
		deps.fetch,
		remainingMs,
	);
	if (outcome.kind === "accepted")
		await writeSentLength(store, store.sessionId, state, record.length);
	return outcome;
}

// 同じ端末で動いている別のsessionの途中の要約を送らないため、記録の最後の変更からこの時間が経ったsessionだけを送る。
const PENDING_IDLE_MS = 10 * 60 * 1000;
const PENDING_PER_REQUEST = 20;

type Pending = { sessionId: string; state: UsageState; mtimeMs: number };
type Sent = Pending & { record: UsageRecord; summary: SessionUsageSummary };

async function pendingSessions(
	store: UsageStore,
	workspaceId: string,
	nowMs: number,
): Promise<Pending[]> {
	const pending: Pending[] = [];
	for (const sessionId of await listSessions(store)) {
		if (sessionId === store.sessionId) continue;
		const change = await recordChangeOf(store, sessionId);
		if (!change || nowMs - change.mtimeMs < PENDING_IDLE_MS) continue;
		const state = await readState(store, sessionId);
		if (state?.workspaceId === workspaceId && change.size > state.sentLength)
			pending.push({ sessionId, state, mtimeMs: change.mtimeMs });
	}
	return pending.sort((a, b) => a.mtimeMs - b.mtimeMs);
}

// correlation.md「送る契機」のSessionStart: 他のsessionの送れていない要約を、最後の変更の古い順に20件まで1つのrequestで送る。
// 2xxを受けたら、rejectedに含まれた要素も含めて送った長さを書く。schemaに違反した要素は送り直しても受け付けられず、
// 閲覧のみのWorkspaceでdropした要素も送り直さないためである。
export async function sendUnsentUsage(
	store: UsageStore,
	destination: Destination,
	deps: SendDeps,
): Promise<SendOutcome | undefined> {
	const workspaceId = workspaceIdOf(destination.key);
	if (workspaceId === undefined) return undefined;
	const batch: Sent[] = [];
	for (const pending of await pendingSessions(
		store,
		workspaceId,
		deps.now().getTime(),
	)) {
		if (batch.length === PENDING_PER_REQUEST) break;
		const record = await readRecord(store, pending.sessionId);
		// 送った長さは最後の改行までであり、追記の途中の行だけが増えた記録は送り直さない。
		if (!record || record.length <= pending.state.sentLength) continue;
		const summary = buildSummary(pending.sessionId, record.lines);
		if (summary) batch.push({ ...pending, record, summary });
	}
	if (batch.length === 0) return undefined;
	const outcome = await postItems(
		destination,
		"v1/session-usage",
		batch.map((sent) => sent.summary),
		deps.fetch,
	);
	if (outcome.kind === "accepted")
		await Promise.all(
			batch.map((sent) =>
				writeSentLength(store, sent.sessionId, sent.state, sent.record.length),
			),
		);
	return outcome;
}
