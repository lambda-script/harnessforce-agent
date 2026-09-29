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
};

// fileの名前をscratchpad_dirの外へ向けないため、これ以外のsession_idではscratchpadを使わない。
const FILE_SAFE_SESSION_ID = /^[A-Za-z0-9_-]+$/;

// semconvのTokenと同じ制約（Unicodeの`White_Space`を含まない、code pointで1〜256文字）。
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
			scratchpadDir && FILE_SAFE_SESSION_ID.test(sessionId)
				? { dir: scratchpadDir, sessionId }
				: undefined,
		source: typeof fields.source === "string" ? fields.source : undefined,
	};
}
