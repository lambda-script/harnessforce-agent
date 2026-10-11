import type { Env } from "@harnessforce/agent-core/types";
import { parseAllowedUrl } from "@harnessforce/agent-core/url";
import { resolveCliDestinations } from "../destinations.js";
import { userSettingsPath } from "../shared/settings.js";
import { stopWith } from "../shared/stop.js";
import { parseStoredApiToken } from "./api-token.js";
import {
	apiTokenAccount,
	ingestKeyAccount,
	ingestOriginAccount,
	type Keychain,
	urlOriginAccount,
} from "./keychain.js";

export type AccessDeps = {
	env: Env;
	keychain: Keychain;
	homeDir: string;
	defaultUrl: string;
};

// 終端ごとの文言。harnessforce runとharnessforce importは、ApiTokenが無い場合の文言だけが異なる。
export type AccessMessages = Record<
	"keychainUnavailable" | "initRequired" | "invalidUrl" | "apiTokenMissing",
	string
>;

export type CliAccess = {
	workspaceId: string;
	ingestKey: string;
	ingestEndpoint: string;
	ingest: URL;
	readApiBase: URL;
	accessToken: string;
};

// correlation.md「CLI」のWorkspaceの決め方と確かめる順、「CLIの宛先の決め方」、送信先の固定。
// どの終端でもRead APIとingestへ何も送らない。
export async function verifyCliAccess(
	deps: AccessDeps,
	messages: AccessMessages,
): Promise<CliAccess> {
	const { keychain } = deps;
	const stop = (message: keyof AccessMessages) => stopWith(messages[message]);
	if (!(await keychain.isAvailable().catch(() => false)))
		stop("keychainUnavailable");
	// 使えると確かめた後の読み出しの失敗も、keychainを使えない場合と同じ終端とする。
	const read = (account: string) =>
		keychain.get(account).catch(() => stop("keychainUnavailable"));
	const destinations = await resolveCliDestinations(
		deps.env,
		userSettingsPath(deps.env, deps.homeDir),
		deps.defaultUrl,
	);

	const workspaceId = destinations.workspaceId ?? stop("initRequired");
	const ingestKey =
		(await read(ingestKeyAccount(workspaceId))) || stop("initRequired");
	const ingestEndpoint = destinations.ingestEndpoint ?? stop("initRequired");
	const ingest = parseAllowedUrl(ingestEndpoint) ?? stop("invalidUrl");
	// hookが拒否する送信先へ、hookと同じ利用者用のkeyを送らない。
	const ingestOrigin = await read(ingestOriginAccount(workspaceId));
	if (ingestOrigin !== ingest.origin) stop("initRequired");
	// 形の違う値（以前のversionのharnessforce initが保存した値を含む）は、ApiTokenが無いものとして扱う。
	const apiToken =
		parseStoredApiToken(
			await read(apiTokenAccount(workspaceId)),
			workspaceId,
		) ?? stop("apiTokenMissing");
	const readApiBase =
		parseAllowedUrl(destinations.readApiUrl) ?? stop("invalidUrl");
	// shellやrepositoryのsettingsが書き換えた接続先へApiTokenを送らない。harnessforce initが使った接続先のoriginへだけ送る。
	const urlOrigin = await read(urlOriginAccount(workspaceId));
	if (urlOrigin !== readApiBase.origin) stop("initRequired");
	return {
		workspaceId,
		ingestKey,
		ingestEndpoint,
		ingest,
		readApiBase,
		accessToken: apiToken.accessToken,
	};
}
