import { isObject } from "@harnessforce/agent-core/object";
import { type AnalysisReport, PROPOSAL_KINDS } from "@harnessforce/semconv";
import { emptyProposalCounts } from "./analyze.js";
import { readJsonFile, writeJsonFile } from "./store.js";

export type ChangeType = (typeof PROPOSAL_KINDS)[number];
export type ProposalComponent = { kind: string; source: string; id: string };

// improvement-loop.md「提案の記録」の記録。`evidence_session_ids`は、帰属が決まっていない提案の帰属を
// 後の分析の実行で決めるために持つ。
export type ProposalRecord = {
	proposal_id: string;
	category: string;
	change_type: ChangeType;
	scope: string;
	path: string;
	project_root: string | null;
	component: ProposalComponent | null;
	expected_hash: string;
	detects_applied: boolean;
	recorded_at: string;
	evidence_session_ids: string[];
	// `pending`は一覧が無く帰属を決めていない、`decided`は決めた（帰属先が無い場合を含む）。
	attribution: "pending" | "decided";
	attributed_session_id: string | null;
	applied_detected_at: string | null;
};

const isRecord = (value: unknown): value is ProposalRecord =>
	isObject(value) &&
	typeof value.proposal_id === "string" &&
	typeof value.change_type === "string" &&
	(PROPOSAL_KINDS as readonly string[]).includes(value.change_type) &&
	Array.isArray(value.evidence_session_ids) &&
	(value.attribution === "pending" || value.attribution === "decided");

export async function readProposals(path: string): Promise<ProposalRecord[]> {
	const value = await readJsonFile(path);
	if (!isObject(value) || !Array.isArray(value.proposals)) return [];
	return value.proposals.filter(isRecord);
}

export const writeProposals = (
	path: string,
	proposals: readonly ProposalRecord[],
) => writeJsonFile(path, { version: 1, proposals });

// 分析の実行のsession（帰属の判定に使う形）。
export type AttributionSession = {
	sessionId: string;
	startedAt: string;
	sendable: boolean | null;
};

// improvement-loop.md「提案の記録」: 根拠のうち送信の範囲にある最も新しいsession。同じ開始なら辞書順で最小のID。
// 一覧が無い（sendableがすべてnull）なら決めない。無いsessionはsendableがfalseのものとして扱う。
export function decideAttribution(
	evidence: readonly string[],
	sessions: ReadonlyMap<string, AttributionSession>,
): { attribution: "pending" | "decided"; sessionId: string | null } {
	const found = evidence.map((id) => sessions.get(id));
	if (found.length > 0 && found.every((s) => s?.sendable === null))
		return { attribution: "pending", sessionId: null };
	const candidates = found.filter(
		(s): s is AttributionSession => s?.sendable === true,
	);
	candidates.sort(
		(a, b) =>
			Date.parse(b.startedAt) - Date.parse(a.startedAt) ||
			(a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0),
	);
	return {
		attribution: "decided",
		sessionId: candidates[0]?.sessionId ?? null,
	};
}

// 帰属先のsessionのanalysis reportに入れる件数。記録から毎回作り、後から受信した行が0で上書きしないようにする。
export function countProposals(
	proposals: readonly ProposalRecord[],
	sessionId: string,
): AnalysisReport["proposals"] {
	const counts = emptyProposalCounts() as Record<
		ChangeType,
		{ shown: number; applied_detected: number }
	>;
	for (const proposal of proposals) {
		if (proposal.attributed_session_id !== sessionId) continue;
		const count = counts[proposal.change_type];
		counts[proposal.change_type] = {
			shown: count.shown + 1,
			applied_detected:
				count.applied_detected +
				(proposal.detects_applied && proposal.applied_detected_at !== null
					? 1
					: 0),
		};
	}
	return counts;
}
