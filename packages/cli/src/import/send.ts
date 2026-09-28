import type { Fetch } from "@harnessforce/agent-core/types";
import type { SessionImport } from "@harnessforce/semconv";
import { REQUEST_TIMEOUT_MS, readJsonObject, underBase } from "../init/http.js";

// ingest-api.md: `/v1/imports/sessions`は1 requestあたり最大100 session。
const BATCH_SIZE = 100;
// correlation.md「session import」: 429と503は同じ要求を3回まで再送し、Retry-Afterは60秒を上限とする。
const MAX_RESENDS = 3;
const MAX_RETRY_AFTER_SECONDS = 60;
// 上限や課金状態でdropされたsessionは、制限が解除されれば受け付けられるため、送り終えたものとしない。
const LIMIT_REASONS = new Set(["monthly_event_limit", "workspace_read_only"]);

type LimitReason = "monthly_event_limit" | "workspace_read_only";

export type SendResult =
	// invalid: schemaに違反したため取り込まれなかったsession（再送しても受け付けられない）。
	| { kind: "done"; imported: number; invalid: number }
	// notImported: この回で取り込めなかったsessionと、送らなかったsessionの合計。
	| { kind: "limited"; reason: LimitReason; notImported: number }
	| { kind: "unauthorized" }
	| { kind: "failed" };

type SendOptions = {
	// ingestの送信先（CLIの宛先の決め方で決めた値）。
	endpoint: URL;
	ingestKey: string;
	sessions: readonly SessionImport[];
	fetch: Fetch;
	sleep: (ms: number) => Promise<void>;
	// 200を受けた要求のうち、送り終えたsessionを状態fileに記録する。
	record: (sessionIds: readonly string[]) => Promise<void>;
};

type Rejection = { index: number; reason: string };
type Reply =
	| { kind: "accepted"; accepted: number; rejected: Rejection[] }
	| { kind: "busy"; retryAfterMs: number }
	| { kind: "unauthorized" }
	| { kind: "failed" };

function retryAfterMs(header: string | null): number {
	const seconds =
		header !== null && /^\d+$/.test(header) ? Number(header) : Infinity;
	return Math.min(seconds, MAX_RETRY_AFTER_SECONDS) * 1000;
}

// ingest-api.md「汎用ingest API」の200の応答`{accepted, rejected[]}`。indexが要求の外を指すものは解釈できない。
function parseResult(
	body: Record<string, unknown> | undefined,
	size: number,
): { accepted: number; rejected: Rejection[] } | undefined {
	if (!body || !Array.isArray(body.rejected)) return undefined;
	const { accepted } = body;
	if (
		typeof accepted !== "number" ||
		!Number.isInteger(accepted) ||
		accepted < 0
	)
		return undefined;
	const rejected: Rejection[] = [];
	for (const item of body.rejected as unknown[]) {
		const { index, reason } = (item ?? {}) as Record<string, unknown>;
		if (
			typeof index !== "number" ||
			!Number.isInteger(index) ||
			index < 0 ||
			index >= size ||
			typeof reason !== "string"
		)
			return undefined;
		rejected.push({ index, reason });
	}
	return { accepted, rejected };
}

async function post(
	url: URL,
	options: SendOptions,
	batch: readonly SessionImport[],
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
			if (response.status === 401) return { kind: "unauthorized" };
			if (response.status === 429 || response.status === 503)
				return {
					kind: "busy",
					retryAfterMs: retryAfterMs(response.headers.get("retry-after")),
				};
			return { kind: "failed" };
		}
		const result = parseResult(await readJsonObject(response), batch.length);
		return result ? { kind: "accepted", ...result } : { kind: "failed" };
	} catch {
		return { kind: "failed" };
	}
}

async function postWithResends(
	url: URL,
	options: SendOptions,
	batch: readonly SessionImport[],
): Promise<Exclude<Reply, { kind: "busy" }>> {
	for (let resends = 0; ; resends += 1) {
		const reply = await post(url, options, batch);
		if (reply.kind !== "busy") return reply;
		if (resends === MAX_RESENDS) return { kind: "failed" };
		await options.sleep(reply.retryAfterMs);
	}
}

// correlation.md「session import」: 100件ずつ送り、200を受けた要求のsessionを記録する。失敗したら残りを送らずに止める。
export async function sendSessions(options: SendOptions): Promise<SendResult> {
	const url = underBase(options.endpoint, "v1/imports/sessions");
	let imported = 0;
	let invalid = 0;
	for (let start = 0; start < options.sessions.length; start += BATCH_SIZE) {
		const batch = options.sessions.slice(start, start + BATCH_SIZE);
		const reply = await postWithResends(url, options, batch);
		if (reply.kind !== "accepted") return reply;
		const limited = reply.rejected.filter((r) => LIMIT_REASONS.has(r.reason));
		const limitedIndexes = new Set(limited.map((r) => r.index));
		await options.record(
			batch
				.filter((_, index) => !limitedIndexes.has(index))
				.map((session) => session.session_id),
		);
		const [firstLimited] = limited;
		if (firstLimited) {
			const unsent = options.sessions.length - (start + batch.length);
			return {
				kind: "limited",
				reason: firstLimited.reason as LimitReason,
				notImported: limitedIndexes.size + unsent,
			};
		}
		invalid += new Set(reply.rejected.map((r) => r.index)).size;
		// correlation.md「session import」: 取り込んだ件数は`accepted`の合計とする。
		imported += reply.accepted;
	}
	return { kind: "done", imported, invalid };
}
