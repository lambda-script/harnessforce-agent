import type { Fetch } from "@harnessforce/agent-core/types";
import { underBase } from "@harnessforce/agent-core/url";
import { REQUEST_TIMEOUT_MS, readJsonObjectBody } from "../shared/http.js";

export type IssueCandidate = { identifier: string; title: string };

// correlation.md「CLI」の`hf run`の手順1の結果。
export type IssueResolution =
	| { kind: "resolved" }
	| { kind: "candidates"; candidates: IssueCandidate[] }
	| { kind: "unauthorized" }
	| { kind: "failed" };

// 解決できなかったときに表示する候補の数（1ページ目の先頭から）。
const MAX_CANDIDATES = 10;
// URLの解析で"."と".."のpathの段は別のpathへ畳まれ、別のresourceを要求してしまう。
const DOT_SEGMENT = /^\.{1,2}$/;

type Answer = { status: number; body: Record<string, unknown> | undefined };

async function get(
	url: URL,
	apiToken: string,
	fetchImpl: Fetch,
	timeoutMs: number,
): Promise<Answer | undefined> {
	try {
		const response = await fetchImpl(url, {
			method: "GET",
			headers: {
				accept: "application/json",
				authorization: `Bearer ${apiToken}`,
			},
			// ApiTokenをredirect先へ送らない。3xxは想定外のstatusとして扱う。
			redirect: "manual",
			signal: AbortSignal.timeout(timeoutMs),
		});
		return {
			status: response.status,
			body: await readJsonObjectBody(response),
		};
	} catch {
		return undefined;
	}
}

// read-api.md「共通の約束」の一覧の形で、要素が`identifier`と`title`を持つものだけを受け付ける。
function parseCandidates(
	body: Record<string, unknown> | undefined,
): IssueCandidate[] | undefined {
	const data = body?.data;
	const nextCursor = body?.next_cursor;
	if (!Array.isArray(data)) return undefined;
	if (nextCursor !== null && typeof nextCursor !== "string") return undefined;
	const candidates: IssueCandidate[] = [];
	for (const item of data.slice(0, MAX_CANDIDATES)) {
		const identifier = (item as Record<string, unknown> | null)?.identifier;
		const title = (item as Record<string, unknown> | null)?.title;
		if (typeof identifier !== "string" || typeof title !== "string")
			return undefined;
		candidates.push({ identifier, title });
	}
	return candidates;
}

async function fetchCandidates(
	base: URL,
	identifier: string,
	apiToken: string,
	fetchImpl: Fetch,
	timeoutMs: number,
): Promise<IssueResolution> {
	const url = underBase(base, "api/v1/issues");
	url.searchParams.set("query", identifier);
	const answer = await get(url, apiToken, fetchImpl, timeoutMs);
	if (answer?.status === 401) return { kind: "unauthorized" };
	const candidates =
		answer?.status === 200 ? parseCandidates(answer.body) : undefined;
	return candidates ? { kind: "candidates", candidates } : { kind: "failed" };
}

export async function resolveIssue(
	base: URL,
	identifier: string,
	apiToken: string,
	fetchImpl: Fetch,
	timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<IssueResolution> {
	// "."と".."はpathで表せないため、解決できないものとして候補へ進む。
	if (!DOT_SEGMENT.test(identifier)) {
		const url = underBase(
			base,
			`api/v1/issues/${encodeURIComponent(identifier)}`,
		);
		const answer = await get(url, apiToken, fetchImpl, timeoutMs);
		if (answer?.status === 200) return { kind: "resolved" };
		if (answer?.status === 401) return { kind: "unauthorized" };
		// 候補の取得へ進むのは404だけ。それ以外は候補も取得しない。
		if (answer?.status !== 404) return { kind: "failed" };
	}
	return fetchCandidates(base, identifier, apiToken, fetchImpl, timeoutMs);
}
