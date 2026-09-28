import { isIssueIdentifier } from "@harnessforce/agent-core/issue";
import type { RunGit } from "@harnessforce/agent-core/process/git";
import type { Env, Fetch } from "@harnessforce/agent-core/types";
import { type AccessMessages, verifyCliAccess } from "../credentials/access.js";
import { createApiTokenSession } from "../credentials/api-token-session.js";
import type { Keychain } from "../credentials/keychain.js";
import { runUntilStop, stopWith } from "../shared/stop.js";
import { resolveLaunchContext } from "./context.js";
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
	sleep: (ms: number) => Promise<void>;
	// 起動し直す前に取り除いたNode.jsの実行時の変数。agentの環境へだけ戻す。
	restoredEnv: Record<string, string>;
};

export type RunArgs = {
	issue: string;
	agent: string;
	agentArgs: readonly string[];
};

const stop = (message: RunMessage): never => stopWith(RUN_MESSAGES[message]);

// 候補の識別子とタイトルはIssueの提供元の外部の利用者が書きうるため、端末の制御文字を表示しない。
const printable = (text: string) => text.replace(/\p{Cc}/gu, "");

function candidateList(candidates: readonly IssueCandidate[]): string {
	const lines = candidates.map(
		({ identifier, title }) => `${printable(identifier)}  ${printable(title)}`,
	);
	return [RUN_MESSAGES.candidatesHeader, ...lines].join("\n");
}

const ACCESS_MESSAGES: AccessMessages = {
	keychainUnavailable: RUN_MESSAGES.keychainUnavailable,
	initRequired: RUN_MESSAGES.initRequired,
	invalidUrl: RUN_MESSAGES.invalidUrl,
	apiTokenMissing: RUN_MESSAGES.issueInitRequired,
};

async function prepareLaunch(args: RunArgs, deps: RunDeps): Promise<Launch> {
	// correlation.md「CLI」の確かめる順1〜8。
	const { workspaceId, ingestEndpoint, readApiBase, accessToken } =
		await verifyCliAccess(deps, ACCESS_MESSAGES);

	// 手順1: Issueの解決。
	if (!isIssueIdentifier(args.issue)) stop("invalidIssue");
	// sessionは、access tokenの期限切れと401でrefreshしたtokenへAuthorizationを置き換える。
	const readFetch = createApiTokenSession({
		keychain: deps.keychain,
		workspaceId,
		readBase: readApiBase,
		fetch: deps.fetch,
		now: () => deps.now().getTime(),
		sleep: deps.sleep,
		homeDir: deps.homeDir,
	}).authorizedFetch(deps.fetch);
	const resolution = await resolveIssue(
		readApiBase,
		args.issue,
		accessToken,
		readFetch,
	);
	// 401はrefreshしても使えるaccess tokenを得られなかった場合だけ届く。
	if (resolution.kind === "unauthorized") stop("loginExpired");
	if (resolution.kind === "failed") stop("issueFailed");
	if (resolution.kind === "candidates") {
		if (resolution.candidates.length === 0) stop("noMatch");
		stopWith(candidateList(resolution.candidates));
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
		// 手順3のshellの環境は、実行時の変数を取り除く前の環境とする。
		shellEnv: { ...deps.env, ...deps.restoredEnv },
		workspaceId,
		ingestEndpoint,
		platform: deps.platform,
	});
}

// correlation.md「CLI」の`hf run --issue <識別子> -- <agent> [args]`。
export function runIssue(args: RunArgs, deps: RunDeps): Promise<number> {
	return runUntilStop(async () => {
		const outcome = await deps.launch(await prepareLaunch(args, deps));
		if (outcome.kind === "exited") return outcome.code;
		deps.stderr(`${launchFailedMessage(args.agent)}\n`);
		return 1;
	}, deps.stderr);
}
