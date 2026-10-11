import {
	type Destination,
	ingestBaseFrom,
} from "@harnessforce/agent-core/ingest";
import type { Env } from "@harnessforce/agent-core/types";
import { resolveCliDestinations } from "../destinations.js";
import { userSettingsPath } from "../shared/settings.js";
import {
	ingestKeyAccount,
	ingestOriginAccount,
	type Keychain,
} from "./keychain.js";

export type UserDestinationDeps = {
	env: Env;
	homeDir: string;
	keychain: Keychain;
};

// `none`はWorkspaceも送信先も無い端末。`skipped`は設定はあるが、送れない端末。`not configured`はWorkspaceと送信先の片方だけが無い場合。
export type UserDestination =
	| { kind: "ok"; destination: Destination }
	| { kind: "none" }
	| {
			kind: "skipped";
			reason:
				| "not configured"
				| "invalid endpoint"
				| "no ingest key"
				| "destination not verified";
	  };

// 利用者用のkeyは、`harnessforce init`が固定した送信先のoriginへだけ出す（correlation.md「CLI」の送信先の固定）。
export async function resolveUserDestination(
	deps: UserDestinationDeps,
): Promise<UserDestination> {
	const { workspaceId, ingestEndpoint } = await resolveCliDestinations(
		deps.env,
		userSettingsPath(deps.env, deps.homeDir),
		"",
	);
	if (!workspaceId && !ingestEndpoint) return { kind: "none" };
	if (!workspaceId || !ingestEndpoint)
		return { kind: "skipped", reason: "not configured" };
	const ingestBase = ingestBaseFrom(ingestEndpoint);
	if (!ingestBase) return { kind: "skipped", reason: "invalid endpoint" };
	if (!(await deps.keychain.isAvailable()))
		return { kind: "skipped", reason: "no ingest key" };
	const key = await deps.keychain.get(ingestKeyAccount(workspaceId));
	if (!key) return { kind: "skipped", reason: "no ingest key" };
	const pinnedOrigin = await deps.keychain.get(
		ingestOriginAccount(workspaceId),
	);
	if (pinnedOrigin !== ingestBase.origin)
		return { kind: "skipped", reason: "destination not verified" };
	return {
		kind: "ok",
		destination: { ingestBase, key, keyKind: "user" },
	};
}
