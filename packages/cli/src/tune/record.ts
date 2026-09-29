import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import {
	canonicalJson,
	hashFileContent,
	hashValue,
} from "@harnessforce/agent-core/config/canonical";
import { isObject } from "@harnessforce/agent-core/object";
import {
	INTERVENTION_KINDS,
	isToken,
	LOOP_KINDS,
	PROPOSAL_KINDS,
} from "@harnessforce/semconv";
import { readAnalysisSessions } from "./analysis-file.js";
import {
	type ChangeType,
	decideAttribution,
	type ProposalComponent,
	type ProposalRecord,
	readProposals,
	writeProposals,
} from "./proposals.js";
import { ensureDir, type TunePaths, writeFileAtomic } from "./store.js";

// improvement-loop.md「提案の記録」: 1 MiBを超える入力は拒否する。
export const MAX_RECORD_INPUT_BYTES = 1024 * 1024;

const SCOPES = ["user", "repository", "local", "managed"] as const;
const COMPONENT_SOURCES = ["managed", "user", "repository", "local", "plugin"];
// 「形式」の変更の種類とHarnessComponentの種類の対応。claude_mdはcomponentを持たない。
const COMPONENT_KINDS: Record<ChangeType, readonly string[]> = {
	permissions: ["permissions"],
	hook: ["hook"],
	skill: ["skill"],
	rule: ["rule"],
	agent: ["agent"],
	command: ["command"],
	loop_prompt: ["command", "skill"],
	mcp_config: ["mcp_server"],
	claude_md: [],
};
const CONTENT_KINDS = new Set(["rule", "skill", "agent", "command"]);
const VALUE_KINDS = new Set(["hook", "permissions", "mcp_server"]);
// 「形式」の対応表で適用の検出を「しない」変更の種類。
const UNDETECTED_CHANGES: ReadonlySet<ChangeType> = new Set(["claude_md"]);

export class RecordInputError extends Error {
	constructor(readonly field: string) {
		super(field);
	}
}

const invalid = (field: string): never => {
	throw new RecordInputError(field);
};

const CATEGORY = new RegExp(
	`^(intervention\\.kind=(${INTERVENTION_KINDS.join("|")})|loop\\.kind=(${LOOP_KINDS.join("|")})|mcp_server=(.+))$`,
);

function parseCategory(value: unknown): string {
	if (typeof value !== "string") return invalid("category");
	const match = CATEGORY.exec(value);
	if (!match) return invalid("category");
	const server = match[4];
	if (server !== undefined && !isToken(server)) return invalid("category");
	return value;
}

const oneOf = <T extends string>(
	values: readonly T[],
	value: unknown,
	field: string,
): T =>
	typeof value === "string" && (values as readonly string[]).includes(value)
		? (value as T)
		: invalid(field);

const absolutePath = (value: unknown, field: string): string =>
	typeof value === "string" && isAbsolute(value) ? value : invalid(field);

function parseComponent(
	value: unknown,
	changeType: ChangeType,
): ProposalComponent | null {
	if (value === undefined) {
		// MCP serverを削除するmcp_configとclaude_mdだけがcomponentを持たない。
		return changeType === "mcp_config" || changeType === "claude_md"
			? null
			: invalid("component");
	}
	if (!isObject(value)) return invalid("component");
	const kind = oneOf(COMPONENT_KINDS[changeType], value.kind, "component.kind");
	const source = oneOf(COMPONENT_SOURCES, value.source, "component.source");
	const { id } = value;
	if (typeof id !== "string" || !isToken(id)) return invalid("component.id");
	return { kind, source, id };
}

type RecordInput = Omit<
	ProposalRecord,
	| "proposal_id"
	| "recorded_at"
	| "attribution"
	| "attributed_session_id"
	| "applied_detected_at"
> & { body: string };

const sha256 = (text: string) =>
	createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

// 「提案の記録」: 期待する内容のhashはconfig snapshotのcomponentのhashと同じ式で求める。
function expectedHash(
	input: Record<string, unknown>,
	component: ProposalComponent | null,
): string {
	const usesValue = component !== null && VALUE_KINDS.has(component.kind);
	if (usesValue) {
		if (!("value" in input)) return invalid("value");
		return hashValue(input.value);
	}
	if (typeof input.content !== "string") return invalid("content");
	return hashFileContent(Buffer.from(input.content, "utf8"));
}

function parseRecordInput(text: string): RecordInput {
	let input: unknown;
	try {
		input = JSON.parse(text);
	} catch {
		return invalid("input");
	}
	if (!isObject(input)) return invalid("input");
	const category = parseCategory(input.category);
	const changeType = oneOf(PROPOSAL_KINDS, input.change_type, "change_type");
	const scope = oneOf(SCOPES, input.scope, "scope");
	const path = absolutePath(input.path, "path");
	const needsRoot = scope === "repository" || scope === "local";
	if (!needsRoot && input.project_root !== undefined)
		return invalid("project_root");
	const projectRoot = needsRoot
		? absolutePath(input.project_root, "project_root")
		: null;
	const component = parseComponent(input.component, changeType);
	if (
		component !== null &&
		CONTENT_KINDS.has(component.kind) &&
		typeof input.content !== "string"
	)
		return invalid("content");
	const hash = expectedHash(input, component);
	const evidence = input.evidence_session_ids;
	if (
		!Array.isArray(evidence) ||
		evidence.length === 0 ||
		!evidence.every((id) => typeof id === "string" && isToken(id))
	)
		return invalid("evidence_session_ids");
	if (typeof input.body !== "string" || input.body.trim() === "")
		return invalid("body");
	return {
		category,
		change_type: changeType,
		scope,
		path,
		project_root: projectRoot,
		component,
		expected_hash: hash,
		detects_applied: component !== null && !UNDETECTED_CHANGES.has(changeType),
		evidence_session_ids: [...new Set(evidence as string[])],
		body: input.body,
	};
}

// 「提案の記録」: category、change_type、path、expected_hashの4つの鍵の正規化したJSONのhash。
const proposalIdOf = (input: {
	category: string;
	change_type: string;
	path: string;
	expected_hash: string;
}) =>
	sha256(
		canonicalJson({
			category: input.category,
			change_type: input.change_type,
			path: input.path,
			expected_hash: input.expected_hash,
		}),
	);

export type RecordResult = {
	proposal_id: string;
	created: boolean;
	attributed_session_id: string | null;
};

export class RecordWriteError extends Error {}

// 同じproposal_idが既にあれば本文だけを置き換え、帰属と検出の記録は変えない。
export async function recordProposal(
	text: string,
	paths: TunePaths,
	now: () => number,
): Promise<RecordResult> {
	const input = parseRecordInput(text);
	const sessions = await readAnalysisSessions(paths.analysis);
	if (!input.evidence_session_ids.every((id) => sessions.has(id)))
		return invalid("evidence_session_ids");
	const proposals = await readProposals(paths.proposals);
	const proposalId = proposalIdOf(input);
	const existing = proposals.find((p) => p.proposal_id === proposalId);
	const { body, ...fields } = input;
	const record: ProposalRecord =
		existing ??
		(() => {
			const decided = decideAttribution(input.evidence_session_ids, sessions);
			return {
				...fields,
				proposal_id: proposalId,
				recorded_at: new Date(now()).toISOString(),
				attribution: decided.attribution,
				attributed_session_id: decided.sessionId,
				applied_detected_at: null,
			};
		})();
	try {
		await ensureDir(paths.proposalBodies);
		await writeFileAtomic(join(paths.proposalBodies, `${proposalId}.md`), body);
		if (!existing)
			await writeProposals(paths.proposals, [...proposals, record]);
	} catch {
		throw new RecordWriteError();
	}
	return {
		proposal_id: proposalId,
		created: !existing,
		attributed_session_id: record.attributed_session_id,
	};
}
