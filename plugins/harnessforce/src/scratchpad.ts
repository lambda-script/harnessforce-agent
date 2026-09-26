import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionRegistration } from "../../../packages/semconv/src/schemas/session-registration.js";

// scratchpad_dirがsessionごとに分かれるとは記載されていないため、fileの名前にsession_idを含める（correlation.md「hook」）。
export type Scratchpad = { dir: string; sessionId: string };

const registrationFile = (pad: Scratchpad) =>
	join(pad.dir, `registration-${pad.sessionId}.json`);
const unauthorizedMark = (pad: Scratchpad) =>
	join(pad.dir, `unauthorized-${pad.sessionId}`);
const firstPromptSentMark = (pad: Scratchpad) =>
	join(pad.dir, `first-prompt-sent-${pad.sessionId}`);

export async function saveRegistration(
	pad: Scratchpad,
	registration: SessionRegistration,
): Promise<void> {
	await writeFile(registrationFile(pad), JSON.stringify(registration));
}

export async function markUnauthorized(pad: Scratchpad): Promise<void> {
	await writeFile(unauthorizedMark(pad), "");
}

export async function isMarkedUnauthorized(pad: Scratchpad): Promise<boolean> {
	return access(unauthorizedMark(pad)).then(
		() => true,
		() => false,
	);
}

// 読めない、または壊れた内容は、保存が無い場合と同じに扱う。
export async function loadRegistration(
	pad: Scratchpad,
): Promise<SessionRegistration | undefined> {
	try {
		const saved: unknown = JSON.parse(
			await readFile(registrationFile(pad), "utf8"),
		);
		return typeof saved === "object" && saved !== null && !Array.isArray(saved)
			? (saved as SessionRegistration)
			: undefined;
	} catch {
		return undefined;
	}
}

// 印をwxで排他的に作るため、同時に届いたpromptでもtrueになるのは1つだけである。
export async function claimFirstPrompt(pad: Scratchpad): Promise<boolean> {
	return writeFile(firstPromptSentMark(pad), "", { flag: "wx" }).then(
		() => true,
		() => false,
	);
}
