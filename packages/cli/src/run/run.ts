import {
	apiTokenAccount,
	ingestKeyAccount,
	ingestOriginAccount,
	type Keychain,
	urlOriginAccount,
} from "../credentials/keychain.js";
import { resolveCliDestinations } from "../destinations.js";
import type { Fetch } from "../init/http.js";
import { userSettingsPath } from "../init/settings.js";
import type { Env } from "../otel-headers.js";
import { parseAllowedUrl } from "../url.js";
import { type RunGit, resolveLaunchContext } from "./context.js";
import { type IssueCandidate, resolveIssue } from "./issues.js";
import { buildLaunch, type Launch, resourceAttributes } from "./launch.js";
import {
	launchFailedMessage,
	RUN_MESSAGES,
	type RunMessage,
} from "./messages.js";

export type LaunchOutcome =
	| { kind: "exited"; code: number }
	| { kind: "failed" };

export type RunDeps = {
	env: Env;
	keychain: Keychain;
	fetch: Fetch;
	stderr: (text: string) => void;
	homeDir: string;
	managedDir: string;
	defaultUrl: string;
	cwd: string;
	git: RunGit;
	now: () => Date;
	platform: NodeJS.Platform;
	launch: (launch: Launch) => Promise<LaunchOutcome>;
};

export type RunArgs = {
	issue: string;
	agent: string;
	agentArgs: readonly string[];
};

// session registrationの`issue_identifier`の制約（semantic-conventions.md）。
const ISSUE_IDENTIFIER = /^\S{1,256}$/;

// 途中の終端はこの値で抜け、表示と終了コードを1か所で決める。
class RunStop {
	constructor(readonly text: string) {}
}
const stop = (message: RunMessage): never => {
	throw new RunStop(RUN_MESSAGES[message]);
};

// keychainの読み出しの失敗は、keychainを使えない場合と同じ終端にする。
async function readKeychain(
	keychain: Keychain,
	account: string,
): Promise<string | undefined> {
	return keychain.get(account).catch(() => stop("keychainUnavailable"));
}

// 候補の識別子とタイトルはIssueの提供元の外部の利用者が書きうるため、端末の制御文字を表示しない。
const printable = (text: string) =>
	text.replace(/[\t\n\r]/g, " ").replace(/\p{Cc}/gu, "");

function candidateList(candidates: readonly IssueCandidate[]): string {
	const lines = candidates.map(({ identifier, title }) =>
		title
			? `  ${printable(identifier)}  ${printable(title)}`
			: `  ${printable(identifier)}`,
	);
	return [RUN_MESSAGES.candidatesHeader, ...lines].join("\n");
}

type Verified = {
	workspaceId: string;
	ingestEndpoint: string;
	readApiBase: URL;
	apiToken: string;
};

// correlation.md「CLI」の確かめる順1〜8。どの終端でもRead APIとingestへ何も送らない。
async function verifyAccess(deps: RunDeps): Promise<Verified> {
	const { keychain } = deps;
	if (!(await keychain.isAvailable().catch(() => false)))
		stop("keychainUnavailable");
	const destinations = await resolveCliDestinations(
		deps.env,
		userSettingsPath(deps.env, deps.homeDir),
		deps.defaultUrl,
	);
	const workspaceId = destinations.workspaceId ?? stop("initRequired");
	if (!(await readKeychain(keychain, ingestKeyAccount(workspaceId))))
		stop("initRequired");
	const ingestEndpoint = destinations.ingestEndpoint ?? stop("initRequired");
	const ingest = parseAllowedUrl(ingestEndpoint) ?? stop("invalidUrl");
	// hookが拒否する送信先へ、hookと同じ利用者用のkeyのテレメトリを送らせない。
	const ingestOrigin = await readKeychain(
		keychain,
		ingestOriginAccount(workspaceId),
	);
	if (!ingestOrigin || ingest.origin !== ingestOrigin) stop("initRequired");
	const apiToken =
		(await readKeychain(keychain, apiTokenAccount(workspaceId))) ??
		stop("issueInitRequired");
	const readApiBase =
		parseAllowedUrl(destinations.readApiUrl) ?? stop("invalidUrl");
	// shellやrepositoryのsettingsが書き換えた接続先へApiTokenを送らない。
	const urlOrigin = await readKeychain(keychain, urlOriginAccount(workspaceId));
	if (!urlOrigin || readApiBase.origin !== urlOrigin) stop("initRequired");
	return { workspaceId, ingestEndpoint, readApiBase, apiToken };
}

async function prepareLaunch(args: RunArgs, deps: RunDeps): Promise<Launch> {
	const { workspaceId, ingestEndpoint, readApiBase, apiToken } =
		await verifyAccess(deps);

	// 手順1: Issueの解決。
	if (!ISSUE_IDENTIFIER.test(args.issue)) stop("invalidIssue");
	const resolution = await resolveIssue(
		readApiBase,
		args.issue,
		apiToken,
		deps.fetch,
	);
	if (resolution.kind === "unauthorized") stop("issueInitRequired");
	if (resolution.kind === "failed") stop("issueFailed");
	if (resolution.kind === "candidates") {
		if (resolution.candidates.length === 0) stop("noMatch");
		throw new RunStop(candidateList(resolution.candidates));
	}

	// 手順2: 起動する前に分かる値。
	const context = await resolveLaunchContext({
		cwd: deps.cwd,
		git: deps.git,
		homeDir: deps.homeDir,
		managedDir: deps.managedDir,
		env: deps.env,
		now: deps.now,
	});

	return buildLaunch({
		agent: args.agent,
		args: args.agentArgs,
		issueIdentifier: args.issue,
		resourceAttributes: resourceAttributes(
			{ issueIdentifier: args.issue, ...context },
			deps.env.OTEL_RESOURCE_ATTRIBUTES,
		),
		shellEnv: deps.env,
		workspaceId,
		ingestEndpoint,
		platform: deps.platform,
	});
}

// correlation.md「CLI」の`hf run --issue <識別子> -- <agent> [args]`。
export async function runIssue(args: RunArgs, deps: RunDeps): Promise<number> {
	let launch: Launch;
	try {
		launch = await prepareLaunch(args, deps);
	} catch (error) {
		if (!(error instanceof RunStop)) throw error;
		deps.stderr(`${error.text}\n`);
		return 1;
	}
	const outcome = await deps.launch(launch);
	if (outcome.kind === "exited") return outcome.code;
	deps.stderr(`${launchFailedMessage(args.agent)}\n`);
	return 1;
}
