import type { SessionRegistration } from "../../../packages/semconv/src/schemas/session-registration.js";

export type Env = Readonly<Record<string, string | undefined>>;
export type Fetch = (url: URL, init: RequestInit) => Promise<Response>;
export type KeyKind = "workspace";
export type Destination = { sessionsUrl: URL; key: string; keyKind: KeyKind };
export type SendOutcome =
	| { kind: "accepted" }
	| { kind: "unauthorized" }
	| { kind: "failed"; reason: string };

// correlation.md「hook」の共通の規則: 送信の上限時間。
const SEND_TIMEOUT_MS = 2000;
// keyを平文で流さないため、http:はlocalの受信だけに許す。
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// HARNESSFORCE_ENDPOINTはpathを含んでよいbase URL。末尾の/を1つに正規化してv1/sessionsを連結する。
export function sessionsUrlFrom(endpoint: string | undefined): URL | undefined {
	if (!endpoint) return undefined;
	let base: URL;
	try {
		base = new URL(endpoint);
	} catch {
		return undefined;
	}
	const isAllowedScheme =
		base.protocol === "https:" ||
		(base.protocol === "http:" && LOOPBACK_HOSTS.has(base.hostname));
	if (!isAllowedScheme) return undefined;
	return new URL(
		`${base.pathname.replace(/\/+$/, "")}/v1/sessions`,
		base.origin,
	);
}

// 利用者用のIngestKey（keychain）はまだ扱わないため、Workspace用のkeyだけを選ぶ。
export function selectKey(
	env: Env,
): { key: string; keyKind: KeyKind } | undefined {
	const key = env.HARNESSFORCE_INGEST_KEY;
	return key ? { key, keyKind: "workspace" } : undefined;
}

export async function postRegistration(
	destination: Destination,
	registration: SessionRegistration,
	fetchImpl: Fetch,
): Promise<SendOutcome> {
	try {
		const response = await fetchImpl(destination.sessionsUrl, {
			method: "POST",
			headers: {
				authorization: `Bearer ${destination.key}`,
				"content-type": "application/json",
			},
			body: JSON.stringify([registration]),
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
