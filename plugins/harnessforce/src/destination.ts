import type { Fetch } from "@harnessforce/agent-core/types";
import { parseAllowedUrl, underBase } from "@harnessforce/agent-core/url";
import type {
	ConfigSnapshot,
	SessionRegistration,
	SessionUsageSummary,
} from "@harnessforce/semconv";

export type IngestItem =
	| SessionRegistration
	| ConfigSnapshot
	| SessionUsageSummary;
export type KeyKind = "user" | "workspace";
export type Destination = { ingestBase: URL; key: string; keyKind: KeyKind };
export type IngestPath =
	| "v1/sessions"
	| "v1/config-snapshots"
	| "v1/session-usage";
export type SendOutcome =
	| { kind: "accepted" }
	| { kind: "unauthorized" }
	| { kind: "failed"; reason: string };

// correlation.md「hook」の共通の規則: 送信の上限時間。
const SEND_TIMEOUT_MS = 2000;
// control-plane.md「IngestKey と ApiToken」: `hf_ik_<workspace_id>_<secret>`。Workspaceのidは`_`を含まない。
const INGEST_KEY_WORKSPACE = /^hf_ik_([A-Za-z0-9-]{1,128})_/;

export const workspaceIdOf = (key: string): string | undefined =>
	INGEST_KEY_WORKSPACE.exec(key)?.[1];

// HARNESSFORCE_ENDPOINTはpathを含んでよいbase URL。schemeを確かめ、末尾の/を除いたpathを持つbaseを返す。
export function ingestBaseFrom(endpoint: string | undefined): URL | undefined {
	const base = parseAllowedUrl(endpoint);
	if (!base) return undefined;
	// userinfo、query、fragmentは送信先に含めない。
	const ingestBase = new URL(base.origin);
	ingestBase.pathname = base.pathname.replace(/\/+$/, "");
	return ingestBase;
}

// bodyは要素の配列とする（ingest-api.md「汎用ingest API」）。
export async function postItems(
	destination: Destination,
	path: IngestPath,
	items: readonly IngestItem[],
	fetchImpl: Fetch,
	timeoutMs = SEND_TIMEOUT_MS,
): Promise<SendOutcome> {
	try {
		const response = await fetchImpl(underBase(destination.ingestBase, path), {
			method: "POST",
			headers: {
				authorization: `Bearer ${destination.key}`,
				"content-type": "application/json",
			},
			body: JSON.stringify(items),
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
