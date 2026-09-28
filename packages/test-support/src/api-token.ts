export type TokenExpiry = { accessToken: string; refreshToken: string };

// keychainの`<workspace_id>:api-token`の値（correlation.md「CLI」の手順5）。
export const storedToken = (
	workspaceId: string,
	name: string,
	expiresAt: TokenExpiry,
) =>
	JSON.stringify({
		access_token: `hf_at_${workspaceId}_${name}`,
		access_token_expires_at: expiresAt.accessToken,
		refresh_token: `hf_rt_${workspaceId}_${name}`,
		refresh_token_expires_at: expiresAt.refreshToken,
	});
