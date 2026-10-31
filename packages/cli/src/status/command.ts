import { isAbsolute } from "node:path";
import type { RunGit } from "@harnessforce/agent-core/process/git";
import type { Env, Fetch } from "@harnessforce/agent-core/types";
import { normalizeRepository } from "@harnessforce/semconv";
import { type AccessMessages, verifyCliAccess } from "../credentials/access.js";
import { createApiTokenSession } from "../credentials/api-token-session.js";
import type { Keychain } from "../credentials/keychain.js";
import {
	fetchOnboarding,
	listConnectedRepositories,
	type OnboardingStep,
	type ReadOutcome,
} from "../import/read-api.js";
import { INIT_MESSAGES } from "../shared/messages.js";
import { runUntilStop, stopWith } from "../shared/stop.js";

export type StatusDeps = {
	env: Env;
	keychain: Keychain;
	stdout: (text: string) => void;
	stderr: (text: string) => void;
	fetch: Fetch;
	homeDir: string;
	defaultUrl: string;
	cwd: string;
	git: RunGit;
	now: () => number;
	sleep: (ms: number) => Promise<void>;
};

export const STATUS_USAGE = "Usage: harnessforce status [--json]\n";

// onboarding.md「harnessforce status」の文言。ログインの期限切れはharnessforce importと同じ文言。
const MESSAGES = {
	failed:
		"Could not read the Harnessforce status. Run `harnessforce init` and try again.",
	loginExpired: "Your login has expired. Run `harnessforce init`",
	sendToResponsible: "(Send this URL to the person responsible.)",
} as const;

const ACCESS_MESSAGES: AccessMessages = {
	keychainUnavailable: INIT_MESSAGES.keychainUnavailable,
	initRequired: MESSAGES.failed,
	invalidUrl: MESSAGES.failed,
	apiTokenMissing: MESSAGES.failed,
};

const STEP_TITLES: Record<number, string> = {
	2: "Connect the GitHub App",
	3: "Assign repositories to a project",
	4: "Set up telemetry",
	5: "Wait for your first run",
};

const STATUS_MARKS = { done: "✓", todo: "・", unavailable: "?" } as const;

function unwrap<T>(outcome: ReadOutcome<T>): T {
	if (outcome.kind === "ok") return outcome.value;
	return stopWith(
		outcome.kind === "unauthorized" ? MESSAGES.loginExpired : MESSAGES.failed,
	);
}

// `origin`のremoteだけを見る（最初のremoteへは代えない）。repositoryの外、originが無い、正規化できないURLはundefined。
async function originRepository(
	cwd: string,
	git: RunGit,
): Promise<string | undefined> {
	// 空のpathを`git -C`へ渡すと、現在のdirectoryが対象になる。
	if (!isAbsolute(cwd)) return undefined;
	const url = await git(cwd, ["remote", "get-url", "origin"]);
	return url === undefined ? undefined : normalizeRepository(url);
}

function stepLine(step: OnboardingStep, forSomeoneElse: boolean): string {
	const parts = [STATUS_MARKS[step.status], STEP_TITLES[step.step]];
	if (step.status === "todo") parts.push(step.url);
	if (step.status === "todo" && forSomeoneElse)
		parts.push(MESSAGES.sendToResponsible);
	return parts.join(" ");
}

async function runStatus(json: boolean, deps: StatusDeps): Promise<number> {
	const access = await verifyCliAccess(deps, ACCESS_MESSAGES);
	const readFetch = createApiTokenSession({
		keychain: deps.keychain,
		workspaceId: access.workspaceId,
		readBase: access.readApiBase,
		fetch: deps.fetch,
		now: deps.now,
		sleep: deps.sleep,
		homeDir: deps.homeDir,
	}).authorizedFetch(deps.fetch);
	const onboarding = unwrap(
		await fetchOnboarding(access.readApiBase, access.accessToken, readFetch),
	);
	const name = await originRepository(deps.cwd, deps.git);
	// remoteのURLは送らず、接続済みの一覧（別名を含む）と手元で照らし合わせる。
	const repository =
		name === undefined
			? null
			: {
					name,
					connected: unwrap(
						await listConnectedRepositories(
							access.readApiBase,
							access.accessToken,
							readFetch,
						),
					).has(name),
				};
	if (json) {
		deps.stdout(`${JSON.stringify({ ...onboarding, repository })}\n`);
		return 0;
	}
	// Memberの未完了の手順2と3（admin_steps）は、担当へURLを渡す旨を添えて番号の順に並べる。
	const lines = [
		...(onboarding.admin_steps ?? []).map((step) => ({ step, admin: true })),
		...onboarding.steps.map((step) => ({ step, admin: false })),
	]
		.sort((a, b) => a.step.step - b.step.step)
		.map(({ step, admin }) => stepLine(step, admin));
	const repositoryLine =
		repository &&
		`This repository (${repository.name}) is ${repository.connected ? "connected" : "not connected"} to the GitHub App`;
	deps.stdout(
		`${[
			`${onboarding.workspace_name} (${onboarding.role})`,
			...lines,
			...(repositoryLine ? [repositoryLine] : []),
		].join("\n")}\n`,
	);
	return 0;
}

// onboarding.md「harnessforce status」。読み取りだけで、終了コードは手順の完了によらず0。
export function statusCommand(
	args: readonly string[],
	deps: StatusDeps,
): Promise<number> {
	const json = args.length === 1 && args[0] === "--json";
	if (args.length > 0 && !json) {
		deps.stderr(STATUS_USAGE);
		return Promise.resolve(1);
	}
	return runUntilStop(() => runStatus(json, deps), deps.stderr);
}
