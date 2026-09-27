import { join } from "node:path";
import { byCodeUnit } from "./config/canonical.js";
import { isObject, listFiles, readJsonObject } from "./config/files.js";

// fileで配るmanaged settingsのdirectory（correlation.md「構成の収集」、claude-code.md「設定」）。
const MANAGED_DIRS: Partial<Record<NodeJS.Platform, string>> = {
	darwin: "/Library/Application Support/ClaudeCode",
	win32: "C:\\Program Files\\ClaudeCode",
};

// LinuxとWSL（Linuxとして動く）は/etc/claude-codeを使う。
export const managedDirFor = (platform: NodeJS.Platform) =>
	MANAGED_DIRS[platform] ?? "/etc/claude-code";

const noGuard = () => {};

// correlation.md「hook」の共通の規則: managed-settings.json、managed-settings.d/の順に見て、envにその名前の文字列を持つ最後のfileの値。
// repositoryのsettingsはprocessの環境変数を書けるが、このfileは変えられない。
export async function readManagedEnv<Name extends string>(
	managedDir: string,
	names: readonly Name[],
): Promise<Record<Name, string | undefined>> {
	const dropInDir = join(managedDir, "managed-settings.d");
	const dropIns = (await listFiles(dropInDir, ".json", false, noGuard)).sort(
		byCodeUnit,
	);
	const files = [
		join(managedDir, "managed-settings.json"),
		...dropIns.map((name) => join(dropInDir, name)),
	];
	const values = Object.fromEntries(
		names.map((name) => [name, undefined]),
	) as Record<Name, string | undefined>;
	for (const file of files) {
		const env = (await readJsonObject(file, noGuard))?.env;
		if (!isObject(env)) continue;
		for (const name of names)
			if (typeof env[name] === "string") values[name] = env[name];
	}
	return values;
}
