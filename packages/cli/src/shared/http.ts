import { isObject } from "@harnessforce/agent-core/object";

// correlation.md「CLI」: Harnessforceへの1回の要求の上限時間。
export const REQUEST_TIMEOUT_MS = 30_000;

export async function readJsonObjectBody(
	response: Response,
): Promise<Record<string, unknown> | undefined> {
	try {
		const value: unknown = await response.json();
		return isObject(value) ? value : undefined;
	} catch {
		return undefined;
	}
}
