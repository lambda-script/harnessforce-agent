import { isAbsolute } from "node:path";
import { isObject } from "@harnessforce/agent-core/object";
import { isToken } from "@harnessforce/semconv";
import type { Scratchpad } from "./scratchpad.js";

export type HookInput = {
	sessionId: string;
	cwd: string;
	promptId: string | undefined;
	scratchpad: Scratchpad | undefined;
	source: string | undefined;
	// eventごとの項目。数えるhookは名前を決めるのに要る項目だけを読む。
	fields: Record<string, unknown>;
};

// fileの名前をscratchpad_dirとCLAUDE_PLUGIN_DATAの外へ向けないため、これ以外のsession_idではfileを作らない。
const FILE_SAFE_SESSION_ID = /^[A-Za-z0-9_-]+$/;
export const isFileSafeSessionId = (sessionId: string) =>
	FILE_SAFE_SESSION_ID.test(sessionId);

const token = (value: unknown) =>
	typeof value === "string" && isToken(value) ? value : undefined;
// 空のcwdで`git -C ""`を呼ぶと現在のdirectoryが対象になるため、絶対pathだけを受け付ける。
const absolutePath = (value: unknown) =>
	typeof value === "string" && isAbsolute(value) ? value : undefined;

function parseJsonObject(raw: string): Record<string, unknown> | undefined {
	try {
		const value: unknown = JSON.parse(raw);
		return isObject(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

export function parseHookInput(raw: string): HookInput | undefined {
	const fields = parseJsonObject(raw);
	const sessionId = token(fields?.session_id);
	const cwd = absolutePath(fields?.cwd);
	if (!fields || !sessionId || !cwd) return undefined;
	const scratchpadDir = absolutePath(fields.scratchpad_dir);
	return {
		sessionId,
		cwd,
		promptId: token(fields.prompt_id),
		scratchpad:
			scratchpadDir && isFileSafeSessionId(sessionId)
				? { dir: scratchpadDir, sessionId }
				: undefined,
		source: typeof fields.source === "string" ? fields.source : undefined,
		fields,
	};
}
