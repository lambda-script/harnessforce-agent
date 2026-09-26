import { ingestKeyAccount, type Keychain } from "./credentials/keychain.js";

export type Env = Readonly<Record<string, string | undefined>>;

// correlation.md「CLI」の`hf otel-headers`。Claude Codeの`otelHeadersHelper`とpluginのhookが起動する。
// keyが得られない場合は何も出力せず失敗し、Claude Codeが利用者へ通知する。
export async function otelHeaders(
	env: Env,
	keychain: Keychain,
	stdout: (text: string) => void,
): Promise<number> {
	const key = await selectKey(env, keychain).catch(() => undefined);
	if (!key) return 1;
	stdout(`${JSON.stringify({ Authorization: `Bearer ${key}` })}\n`);
	return 0;
}

async function selectKey(
	env: Env,
	keychain: Keychain,
): Promise<string | undefined> {
	// managed settingsが配るWorkspace用のkeyを優先し、テレメトリとsession registrationのkeyを揃える。
	if (env.HARNESSFORCE_INGEST_KEY) return env.HARNESSFORCE_INGEST_KEY;
	const workspaceId = env.HARNESSFORCE_WORKSPACE_ID;
	if (!workspaceId || !(await keychain.isAvailable())) return undefined;
	return keychain.get(ingestKeyAccount(workspaceId));
}
