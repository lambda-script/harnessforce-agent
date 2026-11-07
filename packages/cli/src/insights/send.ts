import type { Fetch } from "@harnessforce/agent-core/types";
import { underBase } from "@harnessforce/agent-core/url";
import type { AnalysisReport } from "@harnessforce/semconv";
import { REQUEST_TIMEOUT_MS, readJsonObjectBody } from "../shared/http.js";

// ingest-api.md: `/v1/analysis-reports`は1 requestあたり最大100要素。
const BATCH_SIZE = 100;
// 閲覧のみは支払いで解除されるため、次の実行で送り直す。
const READ_ONLY = "workspace_read_only";

export type SendReportsResult = {
	accepted: number;
	// unsent.jsonに残して次の実行で送るもの。
	keep: AnalysisReport[];
	// ネットワークの失敗、429、5xxで残した件数。
	unreachable: number;
	readOnly: number;
	invalid: { count: number; reasons: string[] };
	// それ以外の4xxで削除したrequestのstatusと件数。
	rejected: { status: number; count: number }[];
	// 401か403を受けたら、送っていない分析結果の件数（残りはすべて削除する）。
	unusableKey: number | undefined;
};

type Options = {
	endpoint: URL;
	ingestKey: string;
	reports: readonly AnalysisReport[];
	fetch: Fetch;
};

type Reply =
	| {
			kind: "accepted";
			accepted: number;
			rejected: { index: number; reason: string }[];
	  }
	| { kind: "status"; status: number }
	| { kind: "unreachable" };

function parseReply(
	body: Record<string, unknown> | undefined,
	size: number,
): Reply {
	const accepted = body?.accepted;
	const rejectedItems = body?.rejected;
	if (
		typeof accepted !== "number" ||
		!Number.isInteger(accepted) ||
		accepted < 0 ||
		!Array.isArray(rejectedItems)
	)
		return { kind: "unreachable" };
	const rejected: { index: number; reason: string }[] = [];
	for (const item of rejectedItems as unknown[]) {
		const { index, reason } = (item ?? {}) as Record<string, unknown>;
		if (
			typeof index !== "number" ||
			!Number.isInteger(index) ||
			index < 0 ||
			index >= size ||
			typeof reason !== "string"
		)
			return { kind: "unreachable" };
		rejected.push({ index, reason });
	}
	return { kind: "accepted", accepted, rejected };
}

async function post(
	url: URL,
	options: Options,
	batch: readonly AnalysisReport[],
): Promise<Reply> {
	try {
		const response = await options.fetch(url, {
			method: "POST",
			headers: {
				authorization: `Bearer ${options.ingestKey}`,
				"content-type": "application/json",
			},
			body: JSON.stringify(batch),
			// keyを別の宛先へ送らないため、redirectは追わない。
			redirect: "manual",
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (response.status !== 200) {
			await response.body?.cancel();
			return { kind: "status", status: response.status };
		}
		return parseReply(await readJsonObjectBody(response), batch.length);
	} catch {
		return { kind: "unreachable" };
	}
}

const isRetryable = (status: number) =>
	status === 429 || (status >= 500 && status <= 599) || status < 400;

// improvement-loop.md「送信」の失敗の扱い。表示は止めず、結果を呼び出し側がunsent.jsonと文言へ反映する。
export async function sendReports(
	options: Options,
): Promise<SendReportsResult> {
	const url = underBase(options.endpoint, "v1/analysis-reports");
	const result: SendReportsResult = {
		accepted: 0,
		keep: [],
		unreachable: 0,
		readOnly: 0,
		invalid: { count: 0, reasons: [] },
		rejected: [],
		unusableKey: undefined,
	};
	const reasons = new Set<string>();
	for (let start = 0; start < options.reports.length; start += BATCH_SIZE) {
		const batch = options.reports.slice(start, start + BATCH_SIZE);
		const rest = options.reports.slice(start);
		const reply = await post(url, options, batch);
		if (
			reply.kind === "unreachable" ||
			(reply.kind === "status" && isRetryable(reply.status))
		) {
			result.keep.push(...rest);
			result.unreachable += rest.length;
			break;
		}
		if (reply.kind === "status") {
			if (reply.status === 401 || reply.status === 403) {
				result.keep = [];
				result.unusableKey = rest.length + result.readOnly + result.unreachable;
				break;
			}
			result.rejected.push({ status: reply.status, count: batch.length });
			continue;
		}
		result.accepted += reply.accepted;
		const rejectedIndexes = new Set<number>();
		for (const { index, reason } of reply.rejected) {
			if (rejectedIndexes.has(index)) continue;
			rejectedIndexes.add(index);
			const report = batch[index] as AnalysisReport;
			if (reason === READ_ONLY) {
				result.keep.push(report);
				result.readOnly += 1;
				continue;
			}
			result.invalid.count += 1;
			// 表示する値だけを通す。制御文字などを含む値でterminalを操作させない。
			reasons.add(/^[a-z0-9_]{1,64}$/.test(reason) ? reason : "unknown");
		}
	}
	result.invalid.reasons = [...reasons];
	return result;
}
