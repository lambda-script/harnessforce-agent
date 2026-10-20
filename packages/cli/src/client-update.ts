import { join } from "node:path";
import {
	type ClientIdentity,
	noticeLine,
	readUpdateState,
	recheckClientStatus,
	type UpdateState,
} from "@harnessforce/agent-core/client-update";
import { ingestBaseFrom } from "@harnessforce/agent-core/ingest";
import type { Env, Fetch } from "@harnessforce/agent-core/types";
import { resolveCliDestinations } from "./destinations.js";
import { userSettingsPath } from "./shared/settings.js";

// client-updates.md「clientの扱い」のCLIの側。

// CLIの他の端末のfileと同じdirectory（~/.harnessforce/）に置く。
export const updateStatePath = (homeDir: string): string =>
	join(homeDir, ".harnessforce", "update-status.json");

export type CliUpdateDeps = {
	client: ClientIdentity;
	env: Env;
	homeDir: string;
	defaultUrl: string;
	// recordingFetchで包んだfetch。
	fetch: Fetch;
	now: () => Date;
	stderr: (text: string) => void;
};

export const readCliUpdateState = (
	homeDir: string,
	version: string,
): Promise<UpdateState | undefined> =>
	readUpdateState(updateStatePath(homeDir), version);

/**
 * 送信を伴うcommandの前に呼ぶ。unsupportedを受けてから24時間以上経っていれば資格情報を送らずに確かめ直し、
 * それでもunsupportedなら真を返す（client-updates.md「送信の停止」）。
 */
export async function isSendingBlocked(deps: CliUpdateDeps): Promise<boolean> {
	const statePath = updateStatePath(deps.homeDir);
	const state = await readUpdateState(statePath, deps.client.version);
	if (state?.status !== "unsupported") return false;
	const { ingestEndpoint } = await resolveCliDestinations(
		deps.env,
		userSettingsPath(deps.env, deps.homeDir),
		deps.defaultUrl,
	);
	const ingestBase = ingestBaseFrom(ingestEndpoint);
	const checked = ingestBase
		? await recheckClientStatus({
				state,
				ingestBase,
				fetch: deps.fetch,
				statePath,
				version: deps.client.version,
				now: deps.now,
			})
		: state;
	return checked?.status === "unsupported";
}

/** commandの出力の後に、更新の状態の1行をstderrへ書く。outdatedは24時間に1回までとする。 */
export async function noticeUpdate(deps: CliUpdateDeps): Promise<void> {
	const statePath = updateStatePath(deps.homeDir);
	const state = await readUpdateState(statePath, deps.client.version);
	if (!state) return;
	const line = await noticeLine("cli", statePath, state, {
		now: deps.now(),
		env: deps.env,
	});
	if (line) deps.stderr(`${line}\n`);
}
