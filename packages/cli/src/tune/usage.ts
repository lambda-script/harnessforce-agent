import type { ResponseUsage, TranscriptUsage } from "../import/transcript.js";

// improvement-loop.md「端末だけの値」: 端末で数えて表示し、提案の根拠にするが、送らない値。
export const USAGE_KINDS = [
	"frequent_compaction",
	"low_cache_reuse",
	"model_choice",
] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

// 規則と閾値はanalyzer_versionに含める。効果を測った根拠ではなく、使い方を見直す目安として決めた値である。
const FREQUENT_COMPACTION_MIN_AUTO = 2;
export const LOW_CACHE_REUSE_MIN_RESPONSES = 20;
const LOW_CACHE_REUSE_MAX_RATIO = 0.5;

export type ModelUsage = {
	model: string;
	responses: number;
	output_tokens: number;
};

export type SessionUsage = {
	compactions_auto: number;
	compactions_manual: number;
	responses: number;
	cache_reuse_ratio: number | null;
	models: ModelUsage[] | null;
	subagent_models: ModelUsage[] | null;
	// 当たるusage.kind。model_choiceはsessionごとには判定しない。
	kinds: UsageKind[];
};

const sum = (values: readonly (number | undefined)[]): number | null =>
	values.every((v) => v !== undefined)
		? values.reduce<number>((total, v) => total + (v as number), 0)
		: null;

function cacheReuseRatio(responses: readonly ResponseUsage[]): number | null {
	const read = sum(responses.map((r) => r.cacheReadTokens));
	const input = sum(responses.map((r) => r.inputTokens));
	const creation = sum(responses.map((r) => r.cacheCreationTokens));
	if (read === null || input === null || creation === null) return null;
	const total = input + read + creation;
	return total === 0 ? null : read / total;
}

function modelsOf(responses: readonly ResponseUsage[]): ModelUsage[] | null {
	const byModel = new Map<string, ModelUsage>();
	for (const response of responses) {
		if (response.outputTokens === undefined) return null;
		const current = byModel.get(response.model) ?? {
			model: response.model,
			responses: 0,
			output_tokens: 0,
		};
		byModel.set(response.model, {
			model: response.model,
			responses: current.responses + 1,
			output_tokens: current.output_tokens + response.outputTokens,
		});
	}
	return [...byModel.values()].sort((a, b) =>
		a.model < b.model ? -1 : a.model > b.model ? 1 : 0,
	);
}

// `subagents`は`<session>/subagents/*.jsonl`ごとのusage。1つでも読めなければnull。
export function summarizeUsage(
	main: TranscriptUsage,
	subagents: readonly TranscriptUsage[] | null,
): SessionUsage {
	const responses = main.responses.length;
	const ratio = cacheReuseRatio(main.responses);
	const kinds: UsageKind[] = [];
	if (main.compactionsAuto >= FREQUENT_COMPACTION_MIN_AUTO)
		kinds.push("frequent_compaction");
	if (
		responses >= LOW_CACHE_REUSE_MIN_RESPONSES &&
		ratio !== null &&
		ratio < LOW_CACHE_REUSE_MAX_RATIO
	)
		kinds.push("low_cache_reuse");
	return {
		compactions_auto: main.compactionsAuto,
		compactions_manual: main.compactionsManual,
		responses,
		cache_reuse_ratio: ratio,
		models: modelsOf(main.responses),
		subagent_models:
			subagents === null
				? null
				: modelsOf(subagents.flatMap((s) => s.responses)),
		kinds,
	};
}
