import { isObject } from "../object.js";
import { byCodeUnit } from "./canonical.js";

// correlation.md「構成の収集」: saltの無いhashから短い秘密を総当たりで戻せないよう、
// 認証情報を持ちうる値をhashの前に除く。
function withoutSecrets(
	entry: Record<string, unknown>,
): Record<string, unknown> {
	const { env, headers, url, args: _args, ...rest } = entry;
	const result: Record<string, unknown> = rest;
	if (isObject(env)) result.env = Object.keys(env).sort(byCodeUnit);
	if (isObject(headers)) result.headers = Object.keys(headers).sort(byCodeUnit);
	const strippedUrl =
		typeof url === "string" ? withoutCredentials(url) : undefined;
	if (strippedUrl !== undefined) result.url = strippedUrl;
	return result;
}

function withoutCredentials(url: string): string | undefined {
	// engines.nodeの>=18にはURL.canParseの無い版を含む。
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return undefined;
	}
	parsed.username = "";
	parsed.password = "";
	parsed.search = "";
	parsed.hash = "";
	return parsed.href;
}

const reduceHookGroup = (group: unknown) =>
	isObject(group) && Array.isArray(group.hooks)
		? {
				...group,
				hooks: group.hooks.map((handler) =>
					isObject(handler) ? withoutSecrets(handler) : handler,
				),
			}
		: group;

// hashの対象。`mcp_server`は値のobject、`hook`はmatcherのgroupごとのhandlerを置き換える。
export function hashInput(kind: string, value: unknown): unknown {
	if (kind === "mcp_server" && isObject(value)) return withoutSecrets(value);
	if (kind === "hook" && Array.isArray(value))
		return value.map(reduceHookGroup);
	return value;
}
