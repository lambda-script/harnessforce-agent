import type { Fetch } from "@harnessforce/agent-core/types";
import {
	fetchOnboarding,
	listConnectedRepositories,
} from "../import/read-api.js";
import {
	assignRepositoriesNextMessage,
	LOGIN_MESSAGES,
} from "../shared/messages.js";
import { printable } from "../shared/terminal.js";

// correlation.md「CLI」の手順8の最後の行。割り当てたrepositoryが無い間のimportは1件も取り込まないため、
// 先に割り当てる画面を示す。一覧を読めなければ、loginの成功を変えずにimportを勧める。
export async function nextStepLine(
	base: URL,
	accessToken: string,
	fetchImpl: Fetch,
): Promise<string> {
	const repositories = await listConnectedRepositories(
		base,
		accessToken,
		fetchImpl,
	);
	if (repositories.kind !== "ok" || repositories.value.size > 0)
		return LOGIN_MESSAGES.next;
	const onboarding = await fetchOnboarding(base, accessToken, fetchImpl);
	// 未接続のGitHub App（手順2）を先に示す。割り当てるrepositoryがまだ無いため。
	// Memberには手順2と3が自分の手順ではないため、admin_stepsにある。
	const pendingStep =
		onboarding.kind === "ok"
			? [...onboarding.value.steps, ...(onboarding.value.admin_steps ?? [])]
					.filter(
						(step) =>
							(step.step === 2 || step.step === 3) && step.status === "todo",
					)
					.sort((a, b) => a.step - b.step)[0]
			: undefined;
	return assignRepositoriesNextMessage(
		pendingStep && printable(pendingStep.url),
	);
}
