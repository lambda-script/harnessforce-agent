import { isObject } from "@harnessforce/agent-core/object";
import {
	CURRENT_TEXT_VERSION,
	readMark,
	readSendState,
	writeSendState,
} from "./files.js";
import { isDue, stateFor, summaryFrom } from "./summary.js";

export type StatuslineDeps = {
	homeDir: string;
	now: () => Date;
	readStdin: (maxBytes: number) => Promise<Buffer>;
	// 元のcommandの終了コード。起動できなければundefined。
	runOriginal: (command: string, input: Buffer) => Promise<number | undefined>;
	// 切り離した子processで送る。待たない。
	spawnSender: (payload: string) => void;
};

// stdinは上限なしですべて読む。元のcommandへ途中で切れたJSONを渡さないため。
const MAX_INPUT_BYTES = Number.MAX_SAFE_INTEGER;

function originalCommand(original: Record<string, unknown> | null) {
	const command = original?.command;
	return isObject(original) && typeof command === "string" && command !== ""
		? command
		: undefined;
}

// usage-limits.md「Claude Code」。元のstatusLineのcommandの出力とexit codeを変えずに返し、その後に利用枠だけを送る。
// 同意の印が無ければ何も送らない。取り出しと送信の失敗は、表示にもexit codeにも影響させない。
export async function statusline(deps: StatuslineDeps): Promise<number> {
	const input = await deps
		.readStdin(MAX_INPUT_BYTES)
		.catch(() => Buffer.alloc(0));
	const mark = await readMark(deps.homeDir);
	const command = originalCommand(mark?.original ?? null);
	const code = command ? await deps.runOriginal(command, input) : undefined;
	await sendIfDue(deps, input, mark).catch(() => {});
	return code ?? 0;
}

async function sendIfDue(
	deps: StatuslineDeps,
	input: Buffer,
	mark: Awaited<ReturnType<typeof readMark>>,
): Promise<void> {
	if (!mark?.consented || mark.text_version !== CURRENT_TEXT_VERSION) return;
	const nowMs = deps.now().getTime();
	const summary = summaryFrom(input.toString("utf8"), nowMs);
	if (!summary) return;
	if (!isDue(summary, await readSendState(deps.homeDir), nowMs)) return;
	// 記録できなければ送らない。記録が無いと、応答のたびに子processを起動してしまう。
	await writeSendState(deps.homeDir, stateFor(summary, nowMs));
	deps.spawnSender(JSON.stringify(summary));
}
