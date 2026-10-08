import {
	appendFile,
	mkdir,
	readFile,
	rename,
	writeFile,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { ConfigComponent } from "@harnessforce/agent-core/config/component";
import { isObject } from "@harnessforce/agent-core/object";
import type { Env } from "@harnessforce/agent-core/types";
import { isInstant, isToken } from "@harnessforce/semconv";
import { isFileSafeSessionId } from "../input.js";

// correlation.md「利用の要約」の記録の場所: CLAUDE_PLUGIN_DATAの`usage/`に、sessionごとの記録のfile（.jsonl）と
// 状態のfile（.json）を置く。scratchpad_dirはsessionごとの場所であり、送れなかった要約を次のsessionから送れない。
export type UsageStore = { dir: string; sessionId: string };

export function usageStoreOf(
	sessionId: string,
	env: Env,
): UsageStore | undefined {
	const data = env.CLAUDE_PLUGIN_DATA;
	if (!data || !isAbsolute(data) || !isFileSafeSessionId(sessionId))
		return undefined;
	return { dir: join(data, "usage"), sessionId };
}

const recordFile = (store: UsageStore, sessionId: string) =>
	join(store.dir, `${sessionId}.jsonl`);
const stateFile = (store: UsageStore, sessionId: string) =>
	join(store.dir, `${sessionId}.json`);

const IDENTIFIER_KINDS = ["skill", "command", "agent", "mcp_server"] as const;
type IdentifierKind = (typeof IDENTIFIER_KINDS)[number];
// pluginのcomponentは、名前から識別子への対応の規則がplugin以外と異なる。
export type Identifier = { id: string; plugin: boolean };
export type Identifiers = Record<IdentifierKind, Identifier[]>;

export type UsageState = {
	workspaceId: string;
	identifiers: Identifiers;
	// 送った記録の長さ（byte数）。未送信なら0。
	sentLength: number;
};

export function identifiersOf(
	components: readonly ConfigComponent[],
): Identifiers {
	const of = (kind: IdentifierKind) => {
		const unique = new Map<string, Identifier>();
		for (const c of components)
			if (c.kind === kind) {
				const plugin = c.source === "plugin";
				unique.set(`${plugin}:${c.id}`, { id: c.id, plugin });
			}
		return [...unique.values()];
	};
	return {
		skill: of("skill"),
		command: of("command"),
		agent: of("agent"),
		mcp_server: of("mcp_server"),
	};
}

// 既にあれば変えない。再開したsessionは最初のsessionの識別子で数える。
export async function createState(
	store: UsageStore,
	state: UsageState,
): Promise<void> {
	await mkdir(store.dir, { recursive: true });
	await writeFile(stateFile(store, store.sessionId), JSON.stringify(state), {
		flag: "wx",
	}).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== "EEXIST") throw error;
	});
}

const isIdentifier = (value: unknown): value is Identifier =>
	isObject(value) &&
	typeof value.id === "string" &&
	isToken(value.id) &&
	typeof value.plugin === "boolean";

function parseState(value: unknown): UsageState | undefined {
	if (!isObject(value) || !isObject(value.identifiers)) return undefined;
	const { workspaceId, identifiers, sentLength } = value;
	const isValid =
		typeof workspaceId === "string" &&
		typeof sentLength === "number" &&
		Number.isSafeInteger(sentLength) &&
		sentLength >= 0 &&
		IDENTIFIER_KINDS.every((kind) => {
			const list = identifiers[kind];
			return Array.isArray(list) && list.every(isIdentifier);
		});
	return isValid ? (value as UsageState) : undefined;
}

// 読めない、または壊れた状態のfileは、状態のfileが無い場合と同じに扱う。
export async function readState(
	store: UsageStore,
	sessionId = store.sessionId,
): Promise<UsageState | undefined> {
	try {
		return parseState(
			JSON.parse(await readFile(stateFile(store, sessionId), "utf8")),
		);
	} catch {
		return undefined;
	}
}

// SessionEndはClaude Codeの予算で止められうるため、書きかけの状態のfileを残さないよう置き換える。
export async function writeSentLength(
	store: UsageStore,
	sessionId: string,
	state: UsageState,
	sentLength: number,
): Promise<void> {
	const file = stateFile(store, sessionId);
	const partial = `${file}.${process.pid}.tmp`;
	await writeFile(partial, JSON.stringify({ ...state, sentLength }));
	await rename(partial, file);
}

const RECORD_KINDS = [
	"start",
	"prompt",
	"skill",
	"command",
	"subagent",
	"mcp",
	"permission",
	"compaction",
] as const;
type RecordKind = (typeof RECORD_KINDS)[number];

// 数えた1回の記録。本文は持たず、構成の識別子（特定できなければ持たない）と回数の種類、時刻、prompt IDだけを持つ。
export type RecordLine = {
	at: string;
	kind: RecordKind;
	promptId?: string;
	id?: string;
	failed?: true;
	trigger?: "auto" | "manual";
};

// 1行を1回の追記の書き込みで書く。並行して動くhookの行を混ぜないためである。
export const appendRecord = (store: UsageStore, line: RecordLine) =>
	appendFile(recordFile(store, store.sessionId), `${JSON.stringify(line)}\n`);

const isOptional = (value: unknown, check: (v: unknown) => boolean) =>
	value === undefined || check(value);
const isTokenValue = (value: unknown) =>
	typeof value === "string" && isToken(value);

function parseLine(text: string): RecordLine[] {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return [];
	}
	if (!isObject(value)) return [];
	const { at, kind, promptId, id, failed, trigger } = value;
	const isValid =
		typeof at === "string" &&
		isInstant(at) &&
		RECORD_KINDS.some((k) => k === kind) &&
		isOptional(promptId, isTokenValue) &&
		isOptional(id, isTokenValue) &&
		isOptional(failed, (v) => v === true) &&
		isOptional(trigger, (v) => v === "auto" || v === "manual");
	return isValid ? [value as RecordLine] : [];
}

export type UsageRecord = { lines: RecordLine[]; length: number };

// 読めない行は数えずに飛ばす。追記の途中の行は数えず、最後の改行までを読んだ長さとする。
export async function readRecord(
	store: UsageStore,
	sessionId = store.sessionId,
): Promise<UsageRecord | undefined> {
	const bytes = await readFile(recordFile(store, sessionId)).catch(
		() => undefined,
	);
	if (!bytes) return undefined;
	const length = bytes.lastIndexOf(0x0a) + 1;
	const lines = bytes
		.subarray(0, length)
		.toString("utf8")
		.split("\n")
		.flatMap(parseLine);
	return { lines, length };
}
