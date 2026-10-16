import { readManagedEnv } from "@harnessforce/agent-core/managed";
import type { Env } from "@harnessforce/agent-core/types";
import { parseAllowedUrl } from "@harnessforce/agent-core/url";
import {
	ingestKeyAccount,
	ingestOriginAccount,
	type Keychain,
} from "./credentials/keychain.js";

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

// correlation.md「CLI」の終了コード。hookはこれで表示する文言を選ぶ（correlation.md「送信の健全性」）。
const EXIT_KEY_MISSING = 3;
const EXIT_WITHHELD = 4;
const EXIT_FAILED = 1;

type KeySelection =
	// 利用者用のkeyは、読んだkeychainとWorkspaceを持つ。移す処理が保存先の判定を繰り返さないためである。
	| {
			kind: "key";
			key: string;
			user?: { keychain: Keychain; workspaceId: string };
	  }
	| { kind: "missing" }
	| { kind: "withheld" }
	| { kind: "failed" };

// correlation.md「CLI」の`harnessforce otel-headers`。Claude Codeの`otelHeadersHelper`とpluginのhookが起動する。
// keyが得られない場合はstdoutへ何も出力せず失敗し、Claude Codeが利用者へ通知する。
// kernelのkeyringから読んだ利用者用のkeyは、出力の後にSecret Serviceへ移す。hookは1秒で打ち切るため、hookからの起動では移さない。
export async function otelHeaders(
	env: Env,
	managedDir: string,
	keychain: Keychain,
	stdout: (text: string) => void,
	stderr: (text: string) => void,
	endStdout: () => Promise<void>,
): Promise<number> {
	const selection = await selectKey(env, managedDir, keychain).catch(
		(): KeySelection => ({ kind: "failed" }),
	);
	if (selection.kind === "withheld") {
		stderr(WITHHELD);
		return EXIT_WITHHELD;
	}
	if (selection.kind === "missing") return EXIT_KEY_MISSING;
	if (selection.kind === "failed") return EXIT_FAILED;
	stdout(`${JSON.stringify({ Authorization: `Bearer ${selection.key}` })}\n`);
	const { user } = selection;
	if (user && !env.HARNESSFORCE_NO_MIGRATE) {
		await endStdout();
		await user.keychain.migrateFromKernel?.(user.workspaceId).catch(() => {});
	}
	return 0;
}

const HOOK_READ_TIMEOUT_MS = 1_000;

async function selectKey(
	env: Env,
	managedDir: string,
	unlimited: Keychain,
): Promise<KeySelection> {
	// managed settingsのfileが配るWorkspace用のkeyを優先し、テレメトリとsession registrationのkeyを揃える。
	// processの環境変数はrepositoryのsettingsが書けるため、Workspace用のkeyには使わない。
	const managed = await readManagedEnv(managedDir, ["HARNESSFORCE_INGEST_KEY"]);
	if (managed.HARNESSFORCE_INGEST_KEY)
		return { kind: "key", key: managed.HARNESSFORCE_INGEST_KEY };
	const workspaceId = env.HARNESSFORCE_WORKSPACE_ID;
	if (!workspaceId) return { kind: "missing" };
	// hookはこのprocessを1秒で打ち切る（correlation.md「実行環境」）。解錠の確認を待つ操作もその時間で止める。
	const keychain = unlimited.withTimeout(HOOK_READ_TIMEOUT_MS);
	if (!(await keychain.isAvailable())) return { kind: "failed" };
	const key = await keychain.get(ingestKeyAccount(workspaceId));
	if (!key) return { kind: "missing" };
	const pinnedOrigin = await keychain.get(ingestOriginAccount(workspaceId));
	return pinnedOrigin && isPinnedDestination(env, pinnedOrigin)
		? { kind: "key", key, user: { keychain, workspaceId } }
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
