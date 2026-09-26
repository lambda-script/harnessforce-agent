import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionRegistration } from "../../../packages/semconv/src/schemas/session-registration.js";

// scratchpad_dirがsessionごとに分かれるとは記載されていないため、fileの名前にsession_idを含める（correlation.md「hook」）。
export type Scratchpad = { dir: string; sessionId: string };

const registrationFile = (pad: Scratchpad) =>
	join(pad.dir, `registration-${pad.sessionId}.json`);
const unauthorizedMark = (pad: Scratchpad) =>
	join(pad.dir, `unauthorized-${pad.sessionId}`);

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
