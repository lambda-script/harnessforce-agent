// correlation.md「CLI」: Harnessforceへの1回の要求の上限時間。
export const REQUEST_TIMEOUT_MS = 30_000;

export async function readJsonObject(
	response: Response,
): Promise<Record<string, unknown> | undefined> {
	try {
		const value: unknown = await response.json();
		return typeof value === "object" && value !== null && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}
