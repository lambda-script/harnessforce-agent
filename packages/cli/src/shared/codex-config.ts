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
import { absoluteEnv } from "@harnessforce/agent-core/config/scope";
import { isObject } from "@harnessforce/agent-core/object";
import type { Env } from "@harnessforce/agent-core/types";

type Table = Record<string, unknown>;

export type CodexConfigInput = {
	// `<接続先>/mcp`の基になる接続先。
	connection: string;
	ingestEndpoint: string;
	ingestKey: string;
	// `--send-content`で、かつ応答の`content_opt_in`が`true`のとき。
	logUserPrompt: boolean;
};

const HOOK_COMMAND = "harnessforce hook session-start";
const HOOK_COMMAND_WINDOWS = "harnessforce.cmd hook session-start";
const HOOK_TIMEOUT_SECONDS = 10;
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

// 他のkeyと値、commentを残し、`[otel].exporter`、harnessforceのSessionStart handler、
// `[mcp_servers].harnessforce`の3つだけを置き換える。書き込む内容は、読み直して期待どおりか確かめる。
// parserのerrorはfileの内容（以前のkeyなど）を含みうるため、内容を持たないerrorに置き換える。
export function mergeCodexConfig(
	text: string,
	input: CodexConfigInput,
): string {
	try {
		const current = parse(text) as Table;
		const desired = withHarnessforce(structuredClone(current), input);
		const result = patch(text, desired);
		if (!isDeepStrictEqual(plain(parse(result)), plain(desired)))
			throw new Error("mismatch");
		return result;
	} catch {
		throw new Error("config.toml cannot be updated");
	}
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
	if (input.logUserPrompt) otel.log_user_prompt = true;

	const hooks = tableAt(config, "hooks");
	const groups = hooks.SessionStart ?? [];
	if (!Array.isArray(groups)) throw new Error("SessionStart");
	hooks.SessionStart = withHandler(groups);

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

const isOurs = (handler: unknown) =>
	isObject(handler) && handler.command === HOOK_COMMAND;
const hasOurs = (group: unknown) =>
	isObject(group) && Array.isArray(group.hooks) && group.hooks.some(isOurs);

// 前に書いたhandlerを新しい値で置き換える。groupのmatcherと他のhandlerは残す。無ければ新しいgroupを加える。
// 要素を取り除く編集は、parserが入れ子のtableを落とすことがあるため行わない。
function withHandler(groups: unknown[]): unknown[] {
	const handler = {
		type: "command",
		command: HOOK_COMMAND,
		commandWindows: HOOK_COMMAND_WINDOWS,
		timeout: HOOK_TIMEOUT_SECONDS,
	};
	if (!groups.some(hasOurs)) return [...groups, { hooks: [handler] }];
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
