import { postItem } from "@harnessforce/agent-core/ingest";
import type { Env, Fetch } from "@harnessforce/agent-core/types";
import type { Keychain } from "../credentials/keychain.js";
import { resolveUserDestination } from "../credentials/user-destination.js";
import { CURRENT_TEXT_VERSION, readMark } from "./files.js";
import { parseSummary } from "./summary.js";

export type SendDeps = {
	env: Env;
	homeDir: string;
	keychain: Keychain;
	fetch: Fetch;
};

// usage-limits.md「Claude Code」: 送信の上限時間。
const SEND_TIMEOUT_MS = 5000;

// `harnessforce usage-limits send <要素>`。statusLineが切り離した子processで起動する。何も出力せず、常にexit 0で終える。
export async function sendUsageLimits(
	raw: string,
	deps: SendDeps,
): Promise<number> {
	const summary = parseSummary(raw);
	if (!summary) return 0;
	// 切り離してから撤回された場合に備えて、送る直前にも同意の印を確かめる。
	const mark = await readMark(deps.homeDir);
	if (!mark?.consented || mark.text_version !== CURRENT_TEXT_VERSION) return 0;
	const resolved = await resolveUserDestination(deps).catch(() => undefined);
	if (resolved?.kind !== "ok") return 0;
	await postItem(
		resolved.destination,
		"v1/usage-limits",
		summary,
		deps.fetch,
		SEND_TIMEOUT_MS,
	);
	return 0;
}
