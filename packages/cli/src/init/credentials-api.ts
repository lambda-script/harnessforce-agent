import { isObject } from "@harnessforce/agent-core/object";
import type { Fetch } from "@harnessforce/agent-core/types";
import { parseAllowedUrl, underBase } from "@harnessforce/agent-core/url";
import {
	parseTokenPair,
	type StoredApiToken,
} from "../credentials/api-token.js";
import { REQUEST_TIMEOUT_MS, readJsonObjectBody } from "../shared/http.js";

export type CredentialRequest = {
	code: string;
	code_verifier: string;
	client_id: string;
	redirect_uri: string;
	revoke_key_hashes: readonly string[];
	revoke_api_token_hashes: readonly string[];
};

export type Issued = {
	workspaceId: string;
	ingestKey: string;
	apiToken: StoredApiToken;
	ingestEndpoint: string;
	content: ContentSettings;
};

// correlation.md「CLI」の手順4: 選ばれたWorkspaceの本文データの設定。
export type ContentSettings = {
	isPromptsStored: boolean;
	isModelAndToolsStored: boolean;
	visibility: ContentVisibility;
	retentionDays: number;
};
type ContentVisibility =
	| "all_members"
	| "owners_admins_and_sender"
	| "sender_only";

const VISIBILITIES: ReadonlySet<string> = new Set([
	"all_members",
	"owners_admins_and_sender",
	"sender_only",
]);
const RETENTION_DAYS: ReadonlySet<unknown> = new Set([7, 14, 30]);

function parseContent(value: unknown): ContentSettings | undefined {
	if (!isObject(value)) return undefined;
	const { prompts, model_and_tools: modelAndTools, visibility } = value;
	const retentionDays = value.retention_days;
	if (
		typeof prompts !== "boolean" ||
		typeof modelAndTools !== "boolean" ||
		typeof visibility !== "string" ||
		!VISIBILITIES.has(visibility) ||
		typeof retentionDays !== "number" ||
		!RETENTION_DAYS.has(retentionDays)
	)
		return undefined;
	return {
		isPromptsStored: prompts,
		isModelAndToolsStored: modelAndTools,
		visibility: visibility as ContentVisibility,
		retentionDays,
	};
}

// correlation.md「CLI」の手順3と4の応答。unexpectedは「いずれにも当たらない応答」。
export type CredentialOutcome =
	| { kind: "issued"; issued: Issued }
	| { kind: "invalid_grant" }
	| { kind: "viewer" }
	| { kind: "limit"; role: LimitRole }
	| { kind: "gate_unavailable" }
	| { kind: "ingest_unavailable" }
	| { kind: "unexpected" };
type LimitRole = "owner" | "admin" | "member";

// control-plane.md「IngestKey と ApiToken」のWorkspaceのidの形式。
const WORKSPACE_ID = /^[A-Za-z0-9-]{1,128}$/;
const NO_WHITESPACE = /^\S+$/;
const LIMIT_ROLES: ReadonlySet<string> = new Set(["owner", "admin", "member"]);

function parseIssued(body: Record<string, unknown>): Issued | undefined {
	const {
		workspace_id: workspaceId,
		ingest_key: ingestKey,
		ingest_endpoint: ingestEndpoint,
		content,
	} = body;
	if (
		typeof workspaceId !== "string" ||
		typeof ingestKey !== "string" ||
		typeof ingestEndpoint !== "string" ||
		!WORKSPACE_ID.test(workspaceId)
	)
		return undefined;
	const apiToken = parseTokenPair(body, workspaceId);
	const parsedContent = parseContent(content);
	const isValid =
		ingestKey.startsWith(`hf_ik_${workspaceId}_`) &&
		NO_WHITESPACE.test(ingestKey) &&
		apiToken !== undefined &&
		parsedContent !== undefined &&
		parseAllowedUrl(ingestEndpoint) !== undefined;
	return isValid && apiToken && parsedContent
		? {
				workspaceId,
				ingestKey,
				apiToken,
				ingestEndpoint,
				content: parsedContent,
			}
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
		return classify(response.status, await readJsonObjectBody(response));
	} catch {
		return { kind: "unexpected" };
	}
}
