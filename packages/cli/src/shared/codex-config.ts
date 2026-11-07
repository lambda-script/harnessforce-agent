import { randomUUID } from "node:crypto";
import {
	chmod,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse, patch } from "@decimalturn/toml-patch";
import {
	CODEX_HOOKS,
	type CodexHookSpec,
} from "@harnessforce/agent-core/codex-hooks";
import { absoluteEnv } from "@harnessforce/agent-core/config/scope";
import { workspaceIdOf } from "@harnessforce/agent-core/ingest";
import { isObject } from "@harnessforce/agent-core/object";
import type { Env } from "@harnessforce/agent-core/types";

type Table = Record<string, unknown>;

export type CodexConfigInput = {
	// `<接続先>/mcp`の基になる接続先。
	connection: string;
	ingestEndpoint: string;
	ingestKey: string;
	// 端末の本文の送信の設定が`on`で、かつ応答の`content`でその区分が`true`のときだけ`true`。送らないときも`false`で書く。
	logUserPrompt: boolean;
	logAgentResponses: boolean;
};

const HOOK_TIMEOUT_SECONDS = 10;

const hookCommand = (spec: CodexHookSpec) =>
	`harnessforce hook ${spec.subcommand}`;
// keyを平文で持つfileであり、利用者のumaskに任せない（correlation.md「Codex」）。
const FILE_MODE = 0o600;

// correlation.md「Codex」: CODEX_HOMEが絶対pathならその下、無ければhome directoryの.codexの下。
export function codexConfigPath(env: Env, homeDir: string): string {
	return join(
		absoluteEnv(env.CODEX_HOME) ?? join(homeDir, ".codex"),
		"config.toml",
	);
}

export async function readCodexConfig(path: string): Promise<string> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
		throw error;
	}
}

// fileが無ければundefined。harnessforce logoutとharnessforce configは、無いfileを作らない。
export async function readExistingCodexConfig(
	path: string,
): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

// `[otel]`のexporterが、`harnessforce login`の書いたIngestKeyで送る設定か。読めないfileは送らない設定として扱う。
export function sendsToHarnessforce(text: string): boolean {
	let config: unknown;
	try {
		config = parse(text);
	} catch {
		return false;
	}
	const exporter =
		isObject(config) && isObject(config.otel) && config.otel.exporter;
	const otlp = isObject(exporter) && exporter["otlp-http"];
	const headers = isObject(otlp) && otlp.headers;
	if (!isObject(headers)) return false;
	// HTTPのheader名は大文字と小文字を区別しない。
	return Object.entries(headers).some(
		([name, value]) =>
			name.toLowerCase() === "authorization" &&
			typeof value === "string" &&
			value.startsWith("Bearer ") &&
			workspaceIdOf(value.slice("Bearer ".length)) !== undefined,
	);
}

// 他のkeyと値、commentを残し、`[otel].exporter`、harnessforceのSessionStart、PostToolUse、Stopのhandler、
// `[mcp_servers].harnessforce`の5つだけを置き換える。書き込む内容は、読み直して期待どおりか確かめる。
// parserのerrorはfileの内容（以前のkeyなど）を含みうるため、内容を持たないerrorに置き換える。
export function mergeCodexConfig(
	text: string,
	input: CodexConfigInput,
): string {
	return editCodexConfig(text, (config) => withHarnessforce(config, input));
}

// commentと他のkeyを残して書き換え、読み直して期待どおりか確かめる。
function editCodexConfig(text: string, edit: (config: Table) => Table): string {
	try {
		const current = parse(text) as Table;
		const desired = edit(structuredClone(current));
		const result = patch(text, desired);
		if (!isDeepStrictEqual(plain(parse(result)), plain(desired)))
			throw new Error("mismatch");
		return result;
	} catch {
		throw new Error("config.toml cannot be updated");
	}
}

// correlation.md「harnessforce logout」の手順1: 失効させた後に書けず、keyの無い設定が残ることを避けるため先に確かめる。
export function isCodexConfigReadable(text: string): boolean {
	try {
		parse(text);
		return true;
	} catch {
		return false;
	}
}

export type ContentLogging = {
	logUserPrompt: boolean;
	logAgentResponses: boolean;
};

// correlation.md「端末の本文の送信の設定」: `[otel]`の`log_user_prompt`と`log_agent_responses`だけを書き換える。
// onlyPresentのときは、あるものだけを書き換え、無いものを加えない。
export function withContentLogging(
	text: string,
	logging: ContentLogging,
	onlyPresent: boolean,
): string {
	return editCodexConfig(text, (config) => {
		const isPresent = isObject(config.otel);
		if (onlyPresent && !isPresent) return config;
		const otel = tableAt(config, "otel");
		const values = {
			log_user_prompt: logging.logUserPrompt,
			log_agent_responses: logging.logAgentResponses,
		};
		for (const [key, value] of Object.entries(values))
			if (!onlyPresent || key in otel) otel[key] = value;
		return config;
	});
}

// correlation.md「harnessforce logout」の手順5: `harnessforce login`が書いた項目だけを消す。
// `[otel].exporter`は利用者用のIngestKeyを平文で持つため、失効できなかった場合も消す。
export function withoutHarnessforce(text: string): string {
	return editCodexConfig(text, (config) => {
		if (isObject(config.otel)) {
			delete config.otel.exporter;
			delete config.otel.log_user_prompt;
			delete config.otel.log_agent_responses;
		}
		if (isObject(config.hooks)) {
			const hooks = config.hooks;
			for (const spec of CODEX_HOOKS) {
				const groups = hooks[spec.event];
				if (!Array.isArray(groups)) continue;
				const kept = withoutHandler(groups, spec);
				if (kept.length > 0) hooks[spec.event] = kept;
				else delete hooks[spec.event];
			}
		}
		if (isObject(config.mcp_servers)) delete config.mcp_servers.harnessforce;
		return config;
	});
}

// harnessforceのhandlerを除き、他のhandlerが残らないgroupは消す。groupのmatcherと他のhandlerは残す。
// parserが入れ子のtableを落とした場合は、editCodexConfigの読み直しの照合で書き換えの失敗になる。
function withoutHandler(groups: unknown[], spec: CodexHookSpec): unknown[] {
	const command = hookCommand(spec);
	return groups.flatMap((group) => {
		if (!isObject(group) || !Array.isArray(group.hooks)) return [group];
		const hooks = group.hooks.filter(
			(entry) => !(isObject(entry) && entry.command === command),
		);
		if (hooks.length === group.hooks.length) return [group];
		return hooks.length > 0 ? [{ ...group, hooks }] : [];
	});
}

// parserが返すtableはprototypeを持たない。形だけを比べるため、通常のobjectに揃える。
function plain(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(plain);
	if (isObject(value) && !(value instanceof Date))
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [key, plain(entry)]),
		);
	return value;
}

function withHarnessforce(config: Table, input: CodexConfigInput): Table {
	const otel = tableAt(config, "otel");
	otel.exporter = {
		"otlp-http": {
			endpoint: input.ingestEndpoint,
			headers: { Authorization: `Bearer ${input.ingestKey}` },
			protocol: "binary",
		},
	};
	// 未設定のときのCodexの既定に結果を依存させないため、送らない区分も明示に`false`で書く。
	otel.log_user_prompt = input.logUserPrompt;
	otel.log_agent_responses = input.logAgentResponses;

	const hooks = tableAt(config, "hooks");
	for (const spec of CODEX_HOOKS) {
		const groups = hooks[spec.event] ?? [];
		if (!Array.isArray(groups)) throw new Error(spec.event);
		hooks[spec.event] = withHandler(groups, spec);
	}

	const servers = tableAt(config, "mcp_servers");
	const existing = servers.harnessforce;
	if (existing !== undefined && !isObject(existing)) throw new Error("server");
	servers.harnessforce = { ...existing, url: `${input.connection}/mcp` };
	return config;
}

function tableAt(parent: Table, key: string): Table {
	const value = parent[key] ?? {};
	if (!isObject(value)) throw new Error(key);
	parent[key] = value;
	return value;
}

// 前に書いたhandlerを新しい値で置き換える。groupのmatcherと他のhandlerは残す。無ければ新しいgroupを加える。
// 要素を取り除く編集は、parserが入れ子のtableを落とすことがあるため行わない。
function withHandler(groups: unknown[], spec: CodexHookSpec): unknown[] {
	const command = hookCommand(spec);
	const isOurs = (entry: unknown) =>
		isObject(entry) && entry.command === command;
	const hasOurs = (group: unknown) =>
		isObject(group) && Array.isArray(group.hooks) && group.hooks.some(isOurs);
	const handler = {
		type: "command",
		command,
		commandWindows: `harnessforce.cmd hook ${spec.subcommand}`,
		timeout: HOOK_TIMEOUT_SECONDS,
		...(spec.isAsync ? { async: true } : {}),
	};
	if (!groups.some(hasOurs))
		return [
			...groups,
			{
				...(spec.matcher === undefined ? {} : { matcher: spec.matcher }),
				hooks: [handler],
			},
		];
	return groups.map((group) =>
		hasOurs(group)
			? {
					...(group as Table),
					hooks: (group as { hooks: unknown[] }).hooks.map((entry) =>
						isOurs(entry) ? handler : entry,
					),
				}
			: group,
	);
}

// Codexも同じfileを読むため、途中まで書かれたfileを読ませないよう同じdirectoryの一時fileからrenameで置き換える。
// 一時fileの時点でmodeを絞り、keyを他のユーザーが読める窓を作らない。
export async function writeCodexConfig(
	path: string,
	text: string,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, text, { mode: FILE_MODE, flag: "wx" });
		await chmod(temporary, FILE_MODE);
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}
