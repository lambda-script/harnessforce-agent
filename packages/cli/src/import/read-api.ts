import type { Fetch } from "@harnessforce/agent-core/types";
import { underBase } from "@harnessforce/agent-core/url";
import { REQUEST_TIMEOUT_MS, readJsonObjectBody } from "../shared/http.js";

// correlation.md「session import」: 401は「Run `harnessforce init`」、それ以外の失敗は通信の失敗として終える。
export type ReadOutcome<T> =
	| { kind: "ok"; value: T }
	| { kind: "unauthorized" }
	| { kind: "failed" };

type Json = Record<string, unknown>;
const FAILED = { kind: "failed" } as const;

// ApiTokenを付けてGETする。redirectは追わない（tokenを別の宛先へ送らない）。
async function getJson(
	url: URL,
	apiToken: string,
	fetchImpl: Fetch,
): Promise<ReadOutcome<Json>> {
	try {
		const response = await fetchImpl(url, {
			headers: {
				accept: "application/json",
				authorization: `Bearer ${apiToken}`,
			},
			redirect: "manual",
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (response.status !== 200) {
			await response.body?.cancel();
			return response.status === 401 ? { kind: "unauthorized" } : FAILED;
		}
		const body = await readJsonObjectBody(response);
		return body ? { kind: "ok", value: body } : FAILED;
	} catch {
		return FAILED;
	}
}

// 1ページの要素。形が違えば、一覧を取得できなかったものとする。
function parsePage(
	body: Json,
): { repositories: string[]; nextCursor: string | undefined } | undefined {
	const { items, next_cursor: nextCursor } = body;
	if (!Array.isArray(items)) return undefined;
	const repositories = items.map((item: unknown) =>
		typeof item === "object" &&
		item !== null &&
		typeof (item as Json).repository === "string"
			? ((item as Json).repository as string)
			: undefined,
	);
	if (repositories.some((repository) => repository === undefined))
		return undefined;
	// read-api.md「共通の約束」: next_cursorは文字列またはnullで、無いページは一覧の形ではない。
	if (nextCursor === null)
		return { repositories: repositories as string[], nextCursor: undefined };
	if (typeof nextCursor !== "string" || nextCursor === "") return undefined;
	return { repositories: repositories as string[], nextCursor };
}

// read-api.md `GET /api/v1/repositories`: GitHub Appで接続済みのrepositoryを、cursorを辿って全ページ取得する。
export async function listConnectedRepositories(
	base: URL,
	apiToken: string,
	fetchImpl: Fetch,
): Promise<ReadOutcome<Set<string>>> {
	const connected = new Set<string>();
	const seenCursors = new Set<string>();
	let cursor: string | undefined;
	do {
		const url = underBase(base, "api/v1/repositories");
		if (cursor !== undefined) url.searchParams.set("cursor", cursor);
		const outcome = await getJson(url, apiToken, fetchImpl);
		if (outcome.kind !== "ok") return outcome;
		const page = parsePage(outcome.value);
		if (!page) return FAILED;
		for (const repository of page.repositories) connected.add(repository);
		cursor = page.nextCursor;
		// 同じcursorが戻ると終わらないため、取得できなかったものとする。
		if (cursor !== undefined && seenCursors.has(cursor)) return FAILED;
		if (cursor !== undefined) seenCursors.add(cursor);
	} while (cursor !== undefined);
	return { kind: "ok", value: connected };
}

// Workspaceの`session_import_days`（billing.md「上限値」）。
export async function fetchSessionImportDays(
	base: URL,
	apiToken: string,
	fetchImpl: Fetch,
): Promise<ReadOutcome<number>> {
	const outcome = await getJson(
		underBase(base, "api/v1/workspace"),
		apiToken,
		fetchImpl,
	);
	if (outcome.kind !== "ok") return outcome;
	const days = outcome.value.session_import_days;
	return typeof days === "number" && Number.isSafeInteger(days) && days >= 1
		? { kind: "ok", value: days }
		: FAILED;
}

export type OnboardingStep = {
	step: number;
	status: "done" | "todo" | "unavailable";
	url: string;
};

export type Onboarding = {
	workspace_name: string;
	role: "owner" | "admin" | "member" | "viewer";
	has_seat: boolean;
	steps: OnboardingStep[];
	admin_steps?: OnboardingStep[];
};

const ROLES = new Set(["owner", "admin", "member", "viewer"]);
const STEP_STATUSES = new Set(["done", "todo", "unavailable"]);

function parseSteps(value: unknown): OnboardingStep[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const steps = value.map((item: unknown) => {
		if (typeof item !== "object" || item === null) return undefined;
		const { step, status, url } = item as Json;
		return Number.isInteger(step) &&
			(step as number) >= 2 &&
			(step as number) <= 5 &&
			STEP_STATUSES.has(status as string) &&
			typeof url === "string"
			? ({ step, status, url } as OnboardingStep)
			: undefined;
	});
	return steps.every((step) => step !== undefined) ? steps : undefined;
}

// onboarding.md「harnessforce status」: `GET /api/v1/onboarding`。形が違えば読めなかったものとする。
export async function fetchOnboarding(
	base: URL,
	apiToken: string,
	fetchImpl: Fetch,
): Promise<ReadOutcome<Onboarding>> {
	const outcome = await getJson(
		underBase(base, "api/v1/onboarding"),
		apiToken,
		fetchImpl,
	);
	if (outcome.kind !== "ok") return outcome;
	const body = outcome.value;
	const steps = parseSteps(body.steps);
	const adminSteps =
		body.admin_steps === undefined ? undefined : parseSteps(body.admin_steps);
	if (
		typeof body.workspace_name !== "string" ||
		!ROLES.has(body.role as string) ||
		typeof body.has_seat !== "boolean" ||
		!steps ||
		(body.admin_steps !== undefined && !adminSteps)
	)
		return FAILED;
	return {
		kind: "ok",
		value: {
			workspace_name: body.workspace_name,
			role: body.role as Onboarding["role"],
			has_seat: body.has_seat,
			steps,
			...(adminSteps && { admin_steps: adminSteps }),
		},
	};
}
