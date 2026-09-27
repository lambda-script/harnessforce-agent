import { chmod, mkdir, open, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

// correlation.md「ApiTokenの失効」: refreshの前に取る排他lock。
export const tokenLockPath = (homeDir: string) =>
	join(homeDir, ".harnessforce", "token.lock");

// lockを待つ上限。これを過ぎたらrefreshの失敗とする。
const LOCK_WAIT_MS = 30_000;
// 作られてからこれを過ぎたlockは、終わらなかったprocessが残したものとみなす。
const STALE_LOCK_MS = 60_000;
const RETRY_INTERVAL_MS = 100;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export type LockDeps = {
	now: () => number;
	sleep: (ms: number) => Promise<void>;
};

const isAlreadyExists = (error: unknown) =>
	(error as NodeJS.ErrnoException | undefined)?.code === "EEXIST";

async function removeIfStale(path: string, now: number): Promise<void> {
	const created = await stat(path).catch(() => undefined);
	if (created && now - created.mtimeMs > STALE_LOCK_MS)
		await rm(path, { force: true });
}

// lockを取れたら外す関数を、30秒待っても取れなければundefinedを返す。
export async function acquireTokenLock(
	path: string,
	deps: LockDeps,
): Promise<(() => Promise<void>) | undefined> {
	await mkdir(dirname(path), { recursive: true, mode: DIR_MODE });
	// mkdirのmodeは新しく作るときだけ効くため、既にあるdirectoryも揃える。
	await chmod(dirname(path), DIR_MODE);
	const deadline = deps.now() + LOCK_WAIT_MS;
	while (deps.now() < deadline) {
		try {
			const handle = await open(path, "wx", FILE_MODE);
			await handle.close();
			return () => rm(path, { force: true });
		} catch (error) {
			if (!isAlreadyExists(error)) throw error;
		}
		await removeIfStale(path, deps.now());
		await deps.sleep(RETRY_INTERVAL_MS);
	}
	return undefined;
}
