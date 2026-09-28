import type { Fetch } from "@harnessforce/agent-core/types";
import { parseAllowedUrl } from "@harnessforce/agent-core/url";
import { REQUEST_TIMEOUT_MS, readJsonObjectBody } from "./http.js";

const WELL_KNOWN = "/.well-known/oauth-authorization-server";

const withoutTrailingSlash = (value: string) => value.replace(/\/+$/, "");

// 接続先をissuerとするauthorization server metadata（RFC 8414）。
// 取得できない、またはissuerが接続先と一致しない場合はundefined。
async function fetchMetadata(
	base: URL,
	fetchImpl: Fetch,
): Promise<Record<string, unknown> | undefined> {
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
		const metadata = await readJsonObjectBody(response);
		// RFC 8414 §3.3: issuerが一致しないmetadataは使わない。
		if (
			typeof metadata?.issuer !== "string" ||
			withoutTrailingSlash(metadata.issuer) !== issuer
		)
			return undefined;
		return metadata;
	} catch {
		return undefined;
	}
}

const endpointOf = (
	metadata: Record<string, unknown> | undefined,
	name: string,
) => {
	const value = metadata?.[name];
	return typeof value === "string" ? parseAllowedUrl(value) : undefined;
};

export async function discoverAuthorizationEndpoint(
	base: URL,
	fetchImpl: Fetch,
): Promise<URL | undefined> {
	return endpointOf(
		await fetchMetadata(base, fetchImpl),
		"authorization_endpoint",
	);
}

// correlation.md「ApiTokenの失効」: refresh tokenを接続先の外へ送らないため、接続先と同じoriginのtoken endpointだけを使う。
export async function discoverTokenEndpoint(
	base: URL,
	fetchImpl: Fetch,
): Promise<URL | undefined> {
	const endpoint = endpointOf(
		await fetchMetadata(base, fetchImpl),
		"token_endpoint",
	);
	return endpoint?.origin === base.origin ? endpoint : undefined;
}
