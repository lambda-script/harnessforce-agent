import { randomUUID } from "node:crypto";
import {
	chmod,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";

// improvement-loop.md「端末のfile」。Harnessforceへ同期しない。
const tuneDir = (homeDir: string) => join(homeDir, ".harnessforce", "tune");

export const tunePaths = (homeDir: string) => {
	const dir = tuneDir(homeDir);
	return {
		dir,
		lock: join(dir, ".lock"),
		repositories: join(dir, "repositories.json"),
		analysis: join(dir, "analysis.json"),
		unsent: join(dir, "unsent.json"),
		sessionConfigs: join(dir, "session-configs.json"),
		proposals: join(dir, "proposals.json"),
		proposalBodies: join(dir, "proposals"),
	};
};
export type TunePaths = ReturnType<typeof tunePaths>;

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

// 「端末のfile」: `repositories.json`と`unsent.json`は、Workspaceとingestの送信先の組ごとに分けて持つ。
export type Destination = { workspaceId: string; endpoint: string };
export const destinationKey = ({ workspaceId, endpoint }: Destination) =>
	`${workspaceId} ${endpoint}`;

// 無い、読めない、JSONでないfileはundefined。形の検査は呼び出し側が行う。
export async function readJsonFile(path: string): Promise<unknown> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as unknown;
	} catch {
		return undefined;
	}
}

export async function ensureDir(dir: string): Promise<void> {
	await mkdir(dir, { recursive: true, mode: DIR_MODE });
	// mkdirのmodeは新しく作るときだけ効くため、既にあるdirectoryも揃える。
	await chmod(dir, DIR_MODE);
}

// 途中まで書かれたfileを読ませないよう、同じdirectoryの一時fileへ書いてからrenameで置き換える。
export async function writeFileAtomic(
	path: string,
	content: string,
): Promise<void> {
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, content, { mode: FILE_MODE, flag: "wx" });
		// umaskの影響を受けないよう、作った後に揃える。
		await chmod(temporary, FILE_MODE);
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}

export const writeJsonFile = (path: string, value: unknown) =>
	writeFileAtomic(path, `${JSON.stringify(value)}\n`);
