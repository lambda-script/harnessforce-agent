import {
	ingestKeyAccount,
	ingestOriginAccount,
	type Keychain,
} from "./credentials/keychain.js";
import { parseAllowedUrl } from "./url.js";

export type Env = Readonly<Record<string, string | undefined>>;

// 利用者用のkeyを付けて送られうる送信先（correlation.md「CLI」の送信先の固定）。
const DESTINATION_VARIABLES = [
	"HARNESSFORCE_ENDPOINT",
	"OTEL_EXPORTER_OTLP_ENDPOINT",
	"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
	"OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
	"OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
] as const;
// 送信先の値はrepositoryが書いたものでありうるため、含めない。
const WITHHELD = "harnessforce: user key withheld (destination not verified)\n";

type KeySelection =
	| { kind: "key"; key: string }
	| { kind: "none" }
	| { kind: "withheld" };

// correlation.md「CLI」の`hf otel-headers`。Claude Codeの`otelHeadersHelper`とpluginのhookが起動する。
// keyが得られない場合はstdoutへ何も出力せず失敗し、Claude Codeが利用者へ通知する。
export async function otelHeaders(
	env: Env,
	keychain: Keychain,
	stdout: (text: string) => void,
	stderr: (text: string) => void,
): Promise<number> {
	const selection = await selectKey(env, keychain).catch(
		(): KeySelection => ({ kind: "none" }),
	);
	if (selection.kind === "withheld") stderr(WITHHELD);
	if (selection.kind !== "key") return 1;
	stdout(`${JSON.stringify({ Authorization: `Bearer ${selection.key}` })}\n`);
	return 0;
}

async function selectKey(env: Env, keychain: Keychain): Promise<KeySelection> {
	// managed settingsが配るWorkspace用のkeyを優先し、テレメトリとsession registrationのkeyを揃える。
	if (env.HARNESSFORCE_INGEST_KEY)
		return { kind: "key", key: env.HARNESSFORCE_INGEST_KEY };
	const workspaceId = env.HARNESSFORCE_WORKSPACE_ID;
	if (!workspaceId || !(await keychain.isAvailable())) return { kind: "none" };
	const key = await keychain.get(ingestKeyAccount(workspaceId));
	if (!key) return { kind: "none" };
	const pinnedOrigin = await keychain.get(ingestOriginAccount(workspaceId));
	return pinnedOrigin && isPinnedDestination(env, pinnedOrigin)
		? { kind: "key", key }
		: { kind: "withheld" };
}

// projectのsettingsのenvはuser settingsより優先されるため、repositoryが送信先を書き換えて利用者用のkeyを受け取ることを防ぐ。
function isPinnedDestination(env: Env, pinnedOrigin: string): boolean {
	const destinations = DESTINATION_VARIABLES.map((name) => env[name]).filter(
		(value): value is string => Boolean(value),
	);
	// otelHeadersHelperのprocessに渡る環境変数は記載されていない。変数が無ければOTLPの送信先はrepositoryが変えられないため出す。
	return destinations.every(
		(value) => parseAllowedUrl(value)?.origin === pinnedOrigin,
	);
}
