import type {
	ConfigSnapshot,
	SessionRegistration,
} from "@harnessforce/semconv";
import type { Fetch } from "./types.js";
import { parseAllowedUrl, underBase } from "./url.js";

// usage-limits.md「送信」。窓の消費率とresetの時刻だけを持つ。
export type UsageLimitSummary = {
	agent: "claude_code";
	observed_at: string;
	windows: {
		window_minutes: number;
		used_percent: number;
		resets_at: string;
	}[];
};
export type IngestItem =
	| SessionRegistration
	| ConfigSnapshot
	| UsageLimitSummary;
export type KeyKind = "user" | "workspace";
export type Destination = { ingestBase: URL; key: string; keyKind: KeyKind };
export type IngestPath =
	| "v1/sessions"
	| "v1/config-snapshots"
	| "v1/usage-limits";
export type SendOutcome =
	| { kind: "accepted" }
	| { kind: "unauthorized" }
	| { kind: "failed"; reason: string };

// pluginのhookとCLIのhookが共有する、ingestへの送信。correlation.md「hook」の共通の規則: 送信の上限時間。
const SEND_TIMEOUT_MS = 2000;

// HARNESSFORCE_ENDPOINTはpathを含んでよいbase URL。schemeを確かめ、末尾の/を除いたpathを持つbaseを返す。
export function ingestBaseFrom(endpoint: string | undefined): URL | undefined {
	const base = parseAllowedUrl(endpoint);
	if (!base) return undefined;
	// userinfo、query、fragmentは送信先に含めない。
	const ingestBase = new URL(base.origin);
	ingestBase.pathname = base.pathname.replace(/\/+$/, "");
	return ingestBase;
}

// bodyは要素1つの配列として送る（ingest-api.md「汎用ingest API」）。
export async function postItem(
	destination: Destination,
	path: IngestPath,
	item: IngestItem,
	fetchImpl: Fetch,
	timeoutMs: number = SEND_TIMEOUT_MS,
): Promise<SendOutcome> {
	try {
		const response = await fetchImpl(underBase(destination.ingestBase, path), {
			method: "POST",
			headers: {
				authorization: `Bearer ${destination.key}`,
				"content-type": "application/json",
			},
			body: JSON.stringify([item]),
			// redirect先へkeyを渡さない。redirectは送信の失敗として扱う。
			redirect: "error",
			signal: AbortSignal.timeout(timeoutMs),
		});
		await response.body?.cancel();
		if (response.status === 401) return { kind: "unauthorized" };
		return response.ok
			? { kind: "accepted" }
			: { kind: "failed", reason: `HTTP ${response.status}` };
	} catch (error) {
		return {
			kind: "failed",
			reason: error instanceof Error ? error.name : "unknown",
		};
	}
}
