import {
	type Collected,
	collectAt,
	type SnapshotDeps,
} from "./config-snapshot.js";
import type { ProposalRecord } from "./proposals.js";

// improvement-loop.md「適用」: 現在の構成に、記録のcomponentと期待する内容のhashがあれば適用を検出する。
// 一度検出した提案は検出したままとする。収集が失敗した実行では判定しない。
export async function detectApplied(
	proposals: readonly ProposalRecord[],
	snapshot: SnapshotDeps,
): Promise<ProposalRecord[]> {
	const byRoot = new Map<string, Promise<Collected>>();
	const collect = (root: string) => {
		const cached = byRoot.get(root) ?? collectAt(root, snapshot);
		byRoot.set(root, cached);
		return cached;
	};
	const detected: ProposalRecord[] = [];
	for (const proposal of proposals) {
		const { component } = proposal;
		if (
			!proposal.detects_applied ||
			proposal.applied_detected_at !== null ||
			component === null
		) {
			detected.push(proposal);
			continue;
		}
		const collected = await collect(proposal.project_root ?? snapshot.homeDir);
		const isApplied =
			collected.kind === "collected" &&
			collected.components.some(
				(c) =>
					c.kind === component.kind &&
					c.source === component.source &&
					c.id === component.id &&
					c.hash === proposal.expected_hash,
			);
		detected.push(
			isApplied
				? {
						...proposal,
						applied_detected_at: new Date(snapshot.now()).toISOString(),
					}
				: proposal,
		);
	}
	return detected;
}
