import type {
	ConfigSnapshot,
	SessionRegistration,
} from "@harnessforce/semconv";
import type { Fetch } from "./types.js";
import { parseAllowedUrl, underBase } from "./url.js";

export type IngestItem = SessionRegistration | ConfigSnapshot;
export type KeyKind = "user" | "workspace";
export type Destination = { ingestBase: URL; key: string; keyKind: KeyKind };
export type IngestPath = "v1/sessions" | "v1/config-snapshots";
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
			signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
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
