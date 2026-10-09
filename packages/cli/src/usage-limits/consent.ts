import type { Fetch } from "@harnessforce/agent-core/types";
import { underBase } from "@harnessforce/agent-core/url";
import { REQUEST_TIMEOUT_MS, readJsonObjectBody } from "../shared/http.js";

// usage-limits.md「同意のendpoint」。ApiTokenのsession（authorizedFetch）がAuthorizationを置き換える。
type ConsentState = {
	workspaceOptedIn: boolean;
	shared: boolean;
	currentTextVersion: number;
};

export type ConsentRead =
	| { kind: "ok"; state: ConsentState }
	| { kind: "unauthorized" }
	| { kind: "failed" };

export type ConsentWrite =
	| { kind: "ok" }
	| { kind: "unauthorized" }
	| { kind: "invalid_text_version" }
	| { kind: "viewer" }
	| { kind: "read_only" }
	| { kind: "failed" };

export type ConsentRevoke =
	| { kind: "ok" }
	| { kind: "unauthorized" }
	| { kind: "failed" };

const consentUrl = (base: URL) =>
	underBase(base, "api/v1/cli/usage-limits/consent");

async function call(
	base: URL,
	fetchImpl: Fetch,
	method: "GET" | "PUT" | "DELETE",
	body?: object,
): Promise<Response | undefined> {
	try {
		return await fetchImpl(consentUrl(base), {
			method,
			headers: {
				accept: "application/json",
				...(body ? { "content-type": "application/json" } : {}),
			},
			...(body ? { body: JSON.stringify(body) } : {}),
			// ApiTokenをredirect先へ送らない。
			redirect: "manual",
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch {
		return undefined;
	}
}

export async function readConsent(
	base: URL,
	fetchImpl: Fetch,
): Promise<ConsentRead> {
	const response = await call(base, fetchImpl, "GET");
	if (response?.status === 401) return { kind: "unauthorized" };
	if (response?.status !== 200) return { kind: "failed" };
	const body = await readJsonObjectBody(response);
	if (
		typeof body?.workspace_opted_in !== "boolean" ||
		typeof body.shared !== "boolean" ||
		typeof body.current_text_version !== "number"
	)
		return { kind: "failed" };
	return {
		kind: "ok",
		state: {
			workspaceOptedIn: body.workspace_opted_in,
			shared: body.shared,
			currentTextVersion: body.current_text_version,
		},
	};
}

export async function recordConsent(
	base: URL,
	fetchImpl: Fetch,
	textVersion: number,
): Promise<ConsentWrite> {
	const response = await call(base, fetchImpl, "PUT", {
		text_version: textVersion,
	});
	if (!response) return { kind: "failed" };
	if (response.status === 204) return { kind: "ok" };
	if (response.status === 401) return { kind: "unauthorized" };
	const body = await readJsonObjectBody(response);
	if (response.status === 400 && body?.code === "invalid_text_version")
		return { kind: "invalid_text_version" };
	if (response.status === 403)
		return body?.code === "workspace_read_only"
			? { kind: "read_only" }
			: { kind: "viewer" };
	return { kind: "failed" };
}

export async function revokeConsent(
	base: URL,
	fetchImpl: Fetch,
): Promise<ConsentRevoke> {
	const response = await call(base, fetchImpl, "DELETE");
	if (response?.status === 204) return { kind: "ok" };
	return response?.status === 401
		? { kind: "unauthorized" }
		: { kind: "failed" };
}
