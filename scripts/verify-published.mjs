import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

// publish直後のregistryへの反映は数分遅れることがある（初回のReleaseは約2分で打ち切って失敗した）。
// 20秒間隔で30回、最大約10分待つ。
export const VIEW_ATTEMPTS = 30;
export const VIEW_INTERVAL_MS = 20_000;

const npmViewOnce = async (spec) => {
	const { stdout } = await run("npm", ["view", spec, "version"]).catch(() => ({
		stdout: "",
	}));
	return stdout.trim();
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function npmView(
	spec,
	{
		attempts = VIEW_ATTEMPTS,
		intervalMs = VIEW_INTERVAL_MS,
		viewOnce = npmViewOnce,
		wait = sleep,
	} = {},
) {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		const version = await viewOnce(spec);
		if (version) return version;
		if (attempt < attempts - 1) await wait(intervalMs);
	}
	return "";
}

/** mergeの成功をreleaseの成功とみなさず、registryにversionが載ったことまで確かめる。 */
export async function verifyPublished(published, view = npmView) {
	const missing = [];
	for (const { name, version } of published) {
		if ((await view(`${name}@${version}`)) !== version)
			missing.push(`${name}@${version}`);
	}
	if (missing.length > 0)
		throw new Error(`not on registry: ${missing.join(", ")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	// biome-ignore lint/suspicious/noUndeclaredEnvVars: turbo経由では実行されず、release workflowが渡す。
	await verifyPublished(JSON.parse(process.env.PUBLISHED_PACKAGES ?? "[]"));
}
