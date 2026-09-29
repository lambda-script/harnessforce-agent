import { open, rm, stat, utimes } from "node:fs/promises";

// improvement-loop.md「端末のfile」: `~/.harnessforce/tune/.lock`の排他lock。
const LOCK_WAIT_MS = 30_000;
// 更新時刻からこれを過ぎたlockは、終わらなかったprocessが残したものとみなす。
const STALE_LOCK_MS = 60_000;
// lockを持つ間、これごとに更新時刻を進め、長い送信の間に奪われないようにする。
const HEARTBEAT_MS = 10_000;
const RETRY_INTERVAL_MS = 100;
const FILE_MODE = 0o600;

export type TuneLockDeps = {
	now: () => number;
	sleep: (ms: number) => Promise<void>;
};

const isAlreadyExists = (error: unknown) =>
	(error as NodeJS.ErrnoException | undefined)?.code === "EEXIST";

async function removeIfStale(path: string, now: number): Promise<void> {
	const current = await stat(path).catch(() => undefined);
	if (current && now - current.mtimeMs > STALE_LOCK_MS)
		await rm(path, { force: true });
}

// lockを取れたら外す関数を、30秒待っても取れなければundefinedを返す。directoryは呼び出し側が作る。
export async function acquireTuneLock(
	path: string,
	deps: TuneLockDeps,
): Promise<(() => Promise<void>) | undefined> {
	const deadline = deps.now() + LOCK_WAIT_MS;
	while (deps.now() < deadline) {
		try {
			const handle = await open(path, "wx", FILE_MODE);
			await handle.close();
			const heartbeat = setInterval(() => {
				const time = new Date();
				utimes(path, time, time).catch(() => {});
			}, HEARTBEAT_MS);
			heartbeat.unref();
			return async () => {
				clearInterval(heartbeat);
				await rm(path, { force: true });
			};
		} catch (error) {
			if (!isAlreadyExists(error)) throw error;
		}
		await removeIfStale(path, deps.now());
		await deps.sleep(RETRY_INTERVAL_MS);
	}
	return undefined;
}
