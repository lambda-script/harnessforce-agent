export type Env = Readonly<Record<string, string | undefined>>;
export type Fetch = (url: URL, init: RequestInit) => Promise<Response>;
export type KeyKind = "workspace";
export type Destination = { ingestBase: URL; key: string; keyKind: KeyKind };
export type IngestPath = "v1/sessions" | "v1/config-snapshots";
export type SendOutcome =
	| { kind: "accepted" }
	| { kind: "unauthorized" }
	| { kind: "failed"; reason: string };

// correlation.md「hook」の共通の規則: 送信の上限時間。
const SEND_TIMEOUT_MS = 2000;
// keyを平文で流さないため、http:はlocalの受信だけに許す。
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// HARNESSFORCE_ENDPOINTはpathを含んでよいbase URL。schemeを確かめ、末尾の/を除いたpathを持つbaseを返す。
export function ingestBaseFrom(endpoint: string | undefined): URL | undefined {
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
	// userinfo、query、fragmentは送信先に含めない。
	const ingestBase = new URL(base.origin);
	ingestBase.pathname = base.pathname.replace(/\/+$/, "");
	return ingestBase;
}

// 文字列の連結で組み立てると、"//host"で始まるpathが別のhostとして解釈されるため、hostを変えずにpathだけを書き換える。
export function ingestUrl(base: URL, path: IngestPath): URL {
	const url = new URL(base.origin);
	url.pathname = `${base.pathname.replace(/\/+$/, "")}/${path}`;
	return url;
}

// 利用者用のIngestKey（keychain）はまだ扱わないため、Workspace用のkeyだけを選ぶ。
export function selectKey(
	env: Env,
): { key: string; keyKind: KeyKind } | undefined {
	const key = env.HARNESSFORCE_INGEST_KEY;
	return key ? { key, keyKind: "workspace" } : undefined;
}

// bodyは要素1つの配列として送る（ingest-api.md「汎用ingest API」）。
export async function postItem(
	destination: Destination,
	path: IngestPath,
	item: unknown,
	fetchImpl: Fetch,
): Promise<SendOutcome> {
	try {
		const response = await fetchImpl(ingestUrl(destination.ingestBase, path), {
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
