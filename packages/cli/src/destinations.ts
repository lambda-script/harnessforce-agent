import { isObject } from "@harnessforce/agent-core/config/files";
import { readUserSettings } from "./init/settings.js";
import type { Env } from "./otel-headers.js";

// correlation.md「CLIの宛先の決め方」とWorkspaceの決め方。hf runとhf importはClaude Codeの外のshellから起動され、
// user settingsのenvは環境に無いため、hf initが書いた値を読む。値の検査は呼び出し側が確かめる順に行う。
export type CliDestinations = {
	workspaceId: string | undefined;
	ingestEndpoint: string | undefined;
	readApiUrl: string;
};

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
	return {
		workspaceId: pick("HARNESSFORCE_WORKSPACE_ID"),
		ingestEndpoint: pick("HARNESSFORCE_ENDPOINT"),
		readApiUrl: pick("HARNESSFORCE_URL") ?? defaultUrl,
	};
}
