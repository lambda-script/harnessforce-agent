import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

// correlation.md「構成の収集」: symlinkは辿り、再帰は収集元のdirectoryから8段まで。
const MAX_DEPTH = 8;

export class CollectionExpired extends Error {}

// 収集の上限時間を超えたら、以降のfilesystemの操作を行わずに打ち切る。
export type Guard = () => void;

export async function readFileIfExists(
	path: string,
	guard: Guard,
): Promise<Buffer | undefined> {
	guard();
	return readFile(path).catch(() => undefined);
}

export async function readJsonObject(
	path: string,
	guard: Guard,
): Promise<Record<string, unknown> | undefined> {
	const content = await readFileIfExists(path, guard);
	if (!content) return undefined;
	try {
		const value: unknown = JSON.parse(content.toString("utf8"));
		return isObject(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

export const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

async function entries(dir: string, guard: Guard): Promise<Dirent[]> {
	guard();
	const found = await readdir(dir, { withFileTypes: true }).catch(() => []);
	return found.filter((entry) => !entry.name.startsWith("."));
}

// symlinkはstatで辿った先の種類で判定する。辿れないlinkは無いものとして扱う。
async function kindOf(
	dir: string,
	entry: Dirent,
	guard: Guard,
): Promise<"file" | "directory" | undefined> {
	if (entry.isFile()) return "file";
	if (entry.isDirectory()) return "directory";
	if (!entry.isSymbolicLink()) return undefined;
	guard();
	const target = await stat(join(dir, entry.name)).catch(() => undefined);
	if (target?.isFile()) return "file";
	return target?.isDirectory() ? "directory" : undefined;
}

// dirの下の、extで終わるfileの相対path（区切りは/）。recursiveでなければ直下だけを見る。
export async function listFiles(
	dir: string,
	ext: string,
	recursive: boolean,
	guard: Guard,
): Promise<string[]> {
	const found: string[] = [];
	const walk = async (relative: string, depth: number): Promise<void> => {
		const current = relative ? join(dir, relative) : dir;
		for (const entry of await entries(current, guard)) {
			const path = relative ? `${relative}/${entry.name}` : entry.name;
			const kind = await kindOf(current, entry, guard);
			if (kind === "file" && entry.name.endsWith(ext)) found.push(path);
			if (kind === "directory" && recursive && depth < MAX_DEPTH)
				await walk(path, depth + 1);
		}
	};
	await walk("", 0);
	return found;
}

export async function listDirectories(
	dir: string,
	guard: Guard,
): Promise<string[]> {
	const names: string[] = [];
	for (const entry of await entries(dir, guard))
		if ((await kindOf(dir, entry, guard)) === "directory")
			names.push(entry.name);
	return names;
}
