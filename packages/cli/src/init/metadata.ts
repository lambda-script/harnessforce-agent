import { parseAllowedUrl } from "../url.js";
import { type Fetch, REQUEST_TIMEOUT_MS, readJsonObject } from "./http.js";

const WELL_KNOWN = "/.well-known/oauth-authorization-server";

const withoutTrailingSlash = (value: string) => value.replace(/\/+$/, "");

// 接続先をissuerとするauthorization server metadata（RFC 8414）からauthorization endpointを知る。
// 取得できない、またはissuerが接続先と一致しない場合はundefined。
export async function discoverAuthorizationEndpoint(
	base: URL,
	fetchImpl: Fetch,
): Promise<URL | undefined> {
	const issuer = withoutTrailingSlash(`${base.origin}${base.pathname}`);
	// RFC 8414 §3.1: well-knownはhostとissuerのpathの間に挿入する。
	const metadataUrl = new URL(base.origin);
	metadataUrl.pathname = `${WELL_KNOWN}${withoutTrailingSlash(base.pathname)}`;
	try {
		const response = await fetchImpl(metadataUrl, {
			headers: { accept: "application/json" },
			redirect: "manual",
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (response.status !== 200) {
			await response.body?.cancel();
			return undefined;
		}
		const metadata = await readJsonObject(response);
		// RFC 8414 §3.3: issuerが一致しないmetadataは使わない。
		if (
			typeof metadata?.issuer !== "string" ||
			withoutTrailingSlash(metadata.issuer) !== issuer ||
			typeof metadata.authorization_endpoint !== "string"
		)
			return undefined;
		return parseAllowedUrl(metadata.authorization_endpoint);
	} catch {
		return undefined;
	}
}
