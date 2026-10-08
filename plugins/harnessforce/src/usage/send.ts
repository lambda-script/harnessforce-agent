import type { Fetch } from "@harnessforce/agent-core/types";
import {
	type Destination,
	postItems,
	type SendOutcome,
	workspaceIdOf,
} from "../destination.js";
import {
	readRecord,
	readState,
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
