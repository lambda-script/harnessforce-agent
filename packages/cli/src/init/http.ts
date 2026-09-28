// correlation.md「CLI」: Harnessforceへの1回の要求の上限時間。
export const REQUEST_TIMEOUT_MS = 30_000;

// 接続先のpathの後ろにpathを連結する。文字列で連結すると"//host"で始まるpathが別のhostになるため、URLで組み立てる。
export function underBase(base: URL, path: string): URL {
	const url = new URL(base.origin);
	url.pathname = `${base.pathname.replace(/\/+$/, "")}/${path}`;
	return url;
}

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
