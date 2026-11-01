import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Fetch } from "@harnessforce/agent-core/types";
import {
	type AnalysisReport,
	INTERVENTION_KINDS,
	LOOP_KINDS,
	PROPOSAL_KINDS,
	type SessionImport,
} from "@harnessforce/semconv";
import { describe, expect, it } from "vitest";
import {
	fetchOnboarding,
	fetchSessionImportDays,
	listConnectedRepositories,
} from "../../src/import/read-api.js";
import { sendSessions } from "../../src/import/send.js";
import { requestCredentials } from "../../src/init/credentials-api.js";
import { sendReports } from "../../src/tune/send.js";

const BASE = new URL("https://app.example.test");
const INGEST = new URL("https://ingest.example.test");

// server が返した 200/201 の body（fixtures の出所は README.md）。
const fixture = (name: string): Record<string, unknown> =>
	JSON.parse(
		readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"),
	) as Record<string, unknown>;

// URLごとに応答を返し、受けた要求を記録する。
function server(respond: (url: URL) => Record<string, unknown>, status = 200) {
	const urls: string[] = [];
	const fetch: Fetch = async (url) => {
		urls.push(url.href);
		return new Response(JSON.stringify(respond(url)), {
			status,
			headers: { "content-type": "application/json" },
		});
	};
	return { fetch, urls };
}

const credentialsRequest = {
	code: "code",
	code_verifier: "verifier",
	client_id: "client",
	redirect_uri: "http://127.0.0.1:1234/callback",
	revoke_key_hashes: [],
	revoke_api_token_hashes: [],
};

const session = (id: string): SessionImport => ({
	agent: "claude_code",
	source: "import",
	session_id: id,
	repository: "github.com/acme/web",
	started_at: "2026-09-20T00:00:00.000Z",
	ended_at: "2026-09-20T01:00:00.000Z",
	model: "claude-a",
	input_tokens: 1,
	output_tokens: 1,
	tool_calls: [],
	parser_version: "1.0.0",
});

// 応答の形を見る test なので、分析結果の中身は空に近い形で足りる。
const unmeasured = (kinds: readonly string[], keys: readonly string[]) =>
	Object.fromEntries(
		kinds.map((kind) => [
			kind,
			Object.fromEntries([
				["measurement", "not_measured"],
				...keys.map((key) => [key, null]),
			]),
		]),
	);
const report = {
	agent: "claude_code",
	session_id: "s0",
	started_at: "2026-11-01T00:00:00.000Z",
	analyzer_version: "1.1.0",
	parser_version: "1.1.0",
	interventions: unmeasured(INTERVENTION_KINDS, [
		"count",
		"wait_seconds_median",
	]),
	loops: unmeasured(LOOP_KINDS, [
		"occurrences",
		"interventions",
		"duration_seconds_median",
	]),
	mcp_servers: [],
	proposals: Object.fromEntries(
		PROPOSAL_KINDS.map((kind) => [kind, { shown: 0, applied_detected: 0 }]),
	),
	records_skipped: 0,
} as unknown as AnalysisReport;

describe("server responses", () => {
	it("reads the 201 of POST /api/v1/cli/credentials", async () => {
		const body = fixture("credentials-201.json");
		const { fetch } = server(() => body, 201);
		expect(
			await requestCredentials(BASE, credentialsRequest, fetch),
		).toMatchObject({
			kind: "issued",
			issued: {
				workspaceId: "4d0f2b9c-6a1e-4c3b-9d7f-2e8a5b1c0f63",
				ingestKey:
					"hf_ik_4d0f2b9c-6a1e-4c3b-9d7f-2e8a5b1c0f63_8f14e45fceea167a5a36dedd4bea2543",
				ingestEndpoint: "https://ingest.example.test",
				content: {
					isPromptsStored: true,
					isModelAndToolsStored: true,
					visibility: "owners_admins_and_sender",
					retentionDays: 30,
				},
			},
		});
	});

	it("follows the cursor through GET /api/v1/repositories", async () => {
		const first = fixture("repositories-page-1.json");
		const last = fixture("repositories-page-2.json");
		const { fetch, urls } = server((url) =>
			url.searchParams.has("cursor") ? last : first,
		);
		expect(await listConnectedRepositories(BASE, "hf_at_token", fetch)).toEqual(
			{
				kind: "ok",
				value: new Set([
					"github.com/acme/web",
					"github.com/acme/api",
					"github.com/acme/docs",
				]),
			},
		);
		expect(urls).toEqual([
			"https://app.example.test/api/v1/repositories",
			"https://app.example.test/api/v1/repositories?cursor=WyIyMDI2LTExLTAxVDAwOjAwOjAwLjAwMFoiLCJhY21lLWFwaSJd",
		]);
	});

	it("reads session_import_days of GET /api/v1/workspace", async () => {
		const body = fixture("workspace-200.json");
		const { fetch } = server(() => body);
		expect(await fetchSessionImportDays(BASE, "hf_at_token", fetch)).toEqual({
			kind: "ok",
			value: 14,
		});
	});

	it("reads the steps of GET /api/v1/onboarding", async () => {
		const body = fixture("onboarding-200.json");
		const { fetch } = server(() => body);
		const outcome = await fetchOnboarding(BASE, "hf_at_token", fetch);
		if (outcome.kind !== "ok") throw new Error(`not ok: ${outcome.kind}`);
		expect(outcome.value).toMatchObject({
			workspace_name: "Acme",
			role: "owner",
			has_seat: true,
		});
		expect(outcome.value.steps.map((step) => step.step)).toEqual([2, 3, 4, 5]);
		expect(outcome.value.steps[0]).toEqual({
			step: 2,
			status: "done",
			url: "https://app.example.test/en/w/acme/settings/connections",
		});
	});

	it("reads the 200 of POST /v1/imports/sessions", async () => {
		const body = fixture("ingest-200.json");
		const { fetch } = server(() => body);
		const recorded: string[] = [];
		expect(
			await sendSessions({
				endpoint: INGEST,
				ingestKey: "hf_ik_workspace_key",
				sessions: [session("s0")],
				fetch,
				sleep: async () => {},
				record: async (ids) => {
					recorded.push(...ids);
				},
			}),
		).toEqual({ kind: "done", imported: 1, invalid: 0 });
		expect(recorded).toEqual(["s0"]);
	});

	it("reads the 200 of POST /v1/analysis-reports", async () => {
		const body = fixture("ingest-200.json");
		const { fetch } = server(() => body);
		expect(
			await sendReports({
				endpoint: INGEST,
				ingestKey: "hf_ik_workspace_key",
				reports: [report],
				fetch,
			}),
		).toMatchObject({
			accepted: 1,
			keep: [],
			unreachable: 0,
			readOnly: 0,
			invalid: { count: 0, reasons: [] },
			rejected: [],
		});
	});
});
