import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

// registryへの反映は数秒遅れることがあるため、10秒間隔で6回まで再試行する。
export async function npmView(spec) {
	for (let attempt = 0; attempt < 6; attempt += 1) {
		const { stdout } = await run("npm", ["view", spec, "version"]).catch(
			() => ({ stdout: "" }),
		);
		if (stdout.trim()) return stdout.trim();
		await new Promise((resolve) => setTimeout(resolve, 10_000));
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
	await verifyPublished(JSON.parse(process.env.PUBLISHED_PACKAGES ?? "[]"));
}
