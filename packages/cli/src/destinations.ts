import { isObject } from "./config/files.js";
import { readUserSettings } from "./init/settings.js";
import type { Env } from "./otel-headers.js";
import { parseAllowedUrl } from "./url.js";

// correlation.md「CLIの宛先の決め方」とWorkspaceの決め方。hf runとhf importはClaude Codeの外のshellから起動され、
// user settingsのenvは環境に無いため、hf initが書いた値を読む。
export type CliDestinations =
	| {
			kind: "resolved";
			readApiBase: URL;
			// scheme、host、port、pathを検査済みの値。子プロセスへはこの文字列のまま渡す。
			ingestEndpoint: string;
			workspaceId: string;
	  }
	| { kind: "initRequired" }
	| { kind: "invalidUrl" };

const NAMES = [
	"HARNESSFORCE_URL",
	"HARNESSFORCE_ENDPOINT",
	"HARNESSFORCE_WORKSPACE_ID",
] as const;
type Name = (typeof NAMES)[number];

// 読めないuser settingsは値を持たないものとして扱い、hf initを案内する。
async function readSettingsEnv(
	settingsPath: string,
): Promise<Partial<Record<Name, string>>> {
	const read = await readUserSettings(settingsPath);
	const env = read.kind === "ok" ? read.settings.env : undefined;
	if (!isObject(env)) return {};
	return Object.fromEntries(
		NAMES.flatMap((name) =>
			typeof env[name] === "string" && env[name] ? [[name, env[name]]] : [],
		),
	);
}

export async function resolveCliDestinations(
	env: Env,
	settingsPath: string,
	defaultUrl: string,
): Promise<CliDestinations> {
	const settings = await readSettingsEnv(settingsPath);
	const pick = (name: Name) => env[name] || settings[name];
	const url = pick("HARNESSFORCE_URL") ?? defaultUrl;
	const ingestEndpoint = pick("HARNESSFORCE_ENDPOINT");
	const workspaceId = pick("HARNESSFORCE_WORKSPACE_ID");
	if (!ingestEndpoint || !workspaceId) return { kind: "initRequired" };
	const readApiBase = parseAllowedUrl(url);
	if (!readApiBase || !parseAllowedUrl(ingestEndpoint))
		return { kind: "invalidUrl" };
	return { kind: "resolved", readApiBase, ingestEndpoint, workspaceId };
}
