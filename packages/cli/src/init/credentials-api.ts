import { parseAllowedUrl } from "../url.js";
import {
	type Fetch,
	REQUEST_TIMEOUT_MS,
	readJsonObject,
	underBase,
} from "./http.js";

export type CredentialRequest = {
	code: string;
	code_verifier: string;
	client_id: string;
	redirect_uri: string;
	revoke_key_hashes: readonly string[];
};

export type Issued = {
	workspaceId: string;
	ingestKey: string;
	apiToken: string;
	ingestEndpoint: string;
};

// correlation.md「CLI」の手順3と4の応答。unexpectedは「いずれにも当たらない応答」。
export type CredentialOutcome =
	| { kind: "issued"; issued: Issued }
	| { kind: "invalid_grant" }
	| { kind: "viewer" }
	| { kind: "limit"; role: LimitRole }
	| { kind: "gate_unavailable" }
	| { kind: "ingest_unavailable" }
	| { kind: "unexpected" };
export type LimitRole = "owner" | "admin" | "member";

// control-plane.md「IngestKey と ApiToken」のWorkspaceのidの形式。
const WORKSPACE_ID = /^[A-Za-z0-9-]{1,128}$/;
const NO_WHITESPACE = /^\S+$/;
const LIMIT_ROLES: ReadonlySet<string> = new Set(["owner", "admin", "member"]);

function parseIssued(body: Record<string, unknown>): Issued | undefined {
	const {
		workspace_id: workspaceId,
		ingest_key: ingestKey,
		api_token: apiToken,
		ingest_endpoint: ingestEndpoint,
	} = body;
	if (
		typeof workspaceId !== "string" ||
		typeof ingestKey !== "string" ||
		typeof apiToken !== "string" ||
		typeof ingestEndpoint !== "string"
	)
		return undefined;
	const isValid =
		WORKSPACE_ID.test(workspaceId) &&
		ingestKey.startsWith(`hf_ik_${workspaceId}_`) &&
		NO_WHITESPACE.test(ingestKey) &&
		NO_WHITESPACE.test(apiToken) &&
		parseAllowedUrl(ingestEndpoint) !== undefined;
	return isValid
		? { workspaceId, ingestKey, apiToken, ingestEndpoint }
		: undefined;
}

function classify(
	status: number,
	body: Record<string, unknown> | undefined,
): CredentialOutcome {
	const code = body?.code;
	if (status === 201) {
		const issued = body && parseIssued(body);
		return issued ? { kind: "issued", issued } : { kind: "unexpected" };
	}
	if (status === 400 && code === "invalid_grant")
		return { kind: "invalid_grant" };
	if (status === 403 && code === "viewer_cannot_issue_ingest_key")
		return { kind: "viewer" };
	const role = body?.role;
	if (
		status === 409 &&
		code === "ingest_key_limit" &&
		typeof role === "string" &&
		LIMIT_ROLES.has(role)
	)
		return { kind: "limit", role: role as LimitRole };
	if (status === 503 && code === "gate_unavailable")
		return { kind: "gate_unavailable" };
	if (status === 503 && code === "ingest_unavailable")
		return { kind: "ingest_unavailable" };
	return { kind: "unexpected" };
}

export async function requestCredentials(
	base: URL,
	request: CredentialRequest,
	fetchImpl: Fetch,
): Promise<CredentialOutcome> {
	try {
		const response = await fetchImpl(
			underBase(base, "api/v1/cli/credentials"),
			{
				method: "POST",
				headers: {
					accept: "application/json",
					"content-type": "application/json",
				},
				body: JSON.stringify(request),
				// redirect先へauthorization codeを渡さない。
				redirect: "error",
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			},
		);
		return classify(response.status, await readJsonObject(response));
	} catch {
		return { kind: "unexpected" };
	}
}
