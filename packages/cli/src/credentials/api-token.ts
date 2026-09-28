import { isObject } from "@harnessforce/agent-core/object";

// keychainの`<workspace_id>:api-token`に保存する形（correlation.md「CLI」の手順5）。値は受け取ったままの文字列で持つ。
export type StoredApiToken = {
	accessToken: string;
	accessTokenExpiresAt: string;
	refreshToken: string;
	refreshTokenExpiresAt: string;
};

const NO_WHITESPACE = /^\S+$/;
// offset付きのISO 8601の瞬間。offsetの無い日時は受け付けない。
const INSTANT =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const isInstant = (value: unknown): value is string =>
	typeof value === "string" &&
	INSTANT.test(value) &&
	!Number.isNaN(Date.parse(value));

const isToken = (value: unknown, prefix: string): value is string =>
	typeof value === "string" &&
	value.startsWith(prefix) &&
	NO_WHITESPACE.test(value);

// `hf_at_<workspace_id>_`と`hf_rt_<workspace_id>_`の組と、それぞれの有効期限。発行とrefreshの応答、keychainの値に共通の形。
export function parseTokenPair(
	value: unknown,
	workspaceId: string,
): StoredApiToken | undefined {
	if (!isObject(value)) return undefined;
	const {
		access_token: accessToken,
		access_token_expires_at: accessTokenExpiresAt,
		refresh_token: refreshToken,
		refresh_token_expires_at: refreshTokenExpiresAt,
	} = value;
	const isValid =
		isToken(accessToken, `hf_at_${workspaceId}_`) &&
		isToken(refreshToken, `hf_rt_${workspaceId}_`) &&
		isInstant(accessTokenExpiresAt) &&
		isInstant(refreshTokenExpiresAt);
	return isValid
		? { accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt }
		: undefined;
}

export const serializeApiToken = (token: StoredApiToken) =>
	JSON.stringify({
		access_token: token.accessToken,
		access_token_expires_at: token.accessTokenExpiresAt,
		refresh_token: token.refreshToken,
		refresh_token_expires_at: token.refreshTokenExpiresAt,
	});

// 形の違う値（以前のversionのhf initが保存した値を含む）は、ApiTokenが無いものとして扱う。
export function parseStoredApiToken(
	secret: string | undefined,
	workspaceId: string,
): StoredApiToken | undefined {
	if (secret === undefined) return undefined;
	try {
		return parseTokenPair(JSON.parse(secret), workspaceId);
	} catch {
		return undefined;
	}
}
