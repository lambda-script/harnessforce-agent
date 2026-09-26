import { constants } from "node:fs";
import { access, open, stat } from "node:fs/promises";
import { posix, win32 } from "node:path";

// correlation.md「commandの解決」。子プロセスのcommandを絶対pathへ解決し、名前のままNode.jsやOSに探させない。
// WindowsのNode.jsとcmd.exeは現在のdirectoryを先に探すため、repositoryに置かれたfileが起動されうる。

export type Env = Readonly<Record<string, string | undefined>>;

export type LookupFileSystem = {
	isFile(path: string): Promise<boolean>;
	isExecutable(path: string): Promise<boolean>;
	exists(path: string): Promise<boolean>;
	// maxBytesを超えるか読めなければundefined。
	readSmallText(path: string, maxBytes: number): Promise<string | undefined>;
	// 先頭のmaxBytesまで。読めなければundefined。
	readHead(path: string, maxBytes: number): Promise<string | undefined>;
};

export type LookupContext = {
	platform: NodeJS.Platform;
	env: Env;
	// 除外の基点。processの現在のdirectoryと、hookでは入力のcwd。
	bases: readonly string[];
	// Node.jsのscriptを起動する実行file。既定は自身のprocessのもの。
	execPath?: string;
	fs?: LookupFileSystem;
};

export type CommandLine = { file: string; args: string[]; verbatim: boolean };

const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";
const NPM_SHIM_MAX_BYTES = 64 * 1024;
const SHEBANG_MAX_BYTES = 256;
// cmd.exeは引用符の中でも%と（遅延展開が有効なら）!を展開し、"は引用を閉じ、改行はcommandを区切る。
const CMD_UNSAFE = /["%!\r\n]/;
const NPM_SHIM_PROG_LINE = 'SET "_prog=%dp0%\\node.exe"';
const NPM_SHIM_LAUNCH_LINE = /"%_prog%"[ \t]+"%dp0%\\([^"]+)"[ \t]+%\*$/;

const pathFor = (platform: NodeJS.Platform) =>
	platform === "win32" ? win32 : posix;

const isBatch = (file: string) => /\.(cmd|bat)$/i.test(file);

// Windowsの環境変数の名前は大文字と小文字を区別しない。testや複製したenvでも同じに読む。
export function envValue(
	env: Env,
	name: string,
	platform: NodeJS.Platform,
): string | undefined {
	if (platform !== "win32") return env[name];
	const upper = name.toUpperCase();
	const key = Object.keys(env).find((k) => k.toUpperCase() === upper);
	return key === undefined ? undefined : env[key];
}

async function readBytes(
	path: string,
	length: number,
): Promise<Buffer | undefined> {
	try {
		const handle = await open(path, "r");
		try {
			const buffer = Buffer.alloc(length);
			const { bytesRead } = await handle.read(buffer, 0, length, 0);
			return buffer.subarray(0, bytesRead);
		} finally {
			await handle.close();
		}
	} catch {
		return undefined;
	}
}

const defaultFs: LookupFileSystem = {
	isFile: async (path) => {
		try {
			return (await stat(path)).isFile();
		} catch {
			return false;
		}
	},
	isExecutable: async (path) => {
		try {
			await access(path, constants.X_OK);
			return true;
		} catch {
			return false;
		}
	},
	exists: async (path) => {
		try {
			await stat(path);
			return true;
		} catch {
			return false;
		}
	},
	readSmallText: async (path, maxBytes) => {
		const bytes = await readBytes(path, maxBytes + 1);
		return bytes === undefined || bytes.length > maxBytes
			? undefined
			: bytes.toString("utf8");
	},
	readHead: async (path, maxBytes) =>
		(await readBytes(path, maxBytes))?.toString("utf8"),
};

type Excluded = (dir: string) => boolean;

// 基点そのものと、基点がgitのrepositoryの中ならそのroot以下を除く。gitの解決にgitは使えないため、`.git`を辿る。
async function excludedDirectories(context: LookupContext): Promise<Excluded> {
	const path = pathFor(context.platform);
	const fs = context.fs ?? defaultFs;
	const key = (dir: string) => {
		const resolved = path.resolve(dir);
		return context.platform === "win32" ? resolved.toLowerCase() : resolved;
	};
	const exact = new Set(context.bases.map(key));
	const roots: string[] = [];
	for (const base of context.bases) {
		let dir = path.resolve(base);
		for (;;) {
			if (await fs.exists(path.join(dir, ".git"))) {
				roots.push(key(dir));
				break;
			}
			const parent = path.dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	}
	return (dir) => {
		const candidate = key(dir);
		if (exact.has(candidate)) return true;
		return roots.some((root) => {
			const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
			return candidate === root || candidate.startsWith(prefix);
		});
	};
}

function candidateNames(name: string, context: LookupContext): string[] {
	if (context.platform !== "win32") return [name];
	const extensions = (
		envValue(context.env, "PATHEXT", "win32") ?? DEFAULT_PATHEXT
	)
		.split(";")
		.filter(Boolean);
	const extension = win32.extname(name).toLowerCase();
	// `claude.cmd`は`claude.cmd.CMD`を探さない。
	if (extension && extensions.some((e) => e.toLowerCase() === extension))
		return [name];
	return extensions.map((e) => `${name}${e}`);
}

async function findIn(
	name: string,
	context: LookupContext,
	excluded: Excluded,
): Promise<string | undefined> {
	const path = pathFor(context.platform);
	const fs = context.fs ?? defaultFs;
	const dirs = (envValue(context.env, "PATH", context.platform) ?? "")
		.split(path.delimiter)
		.filter((dir) => dir !== "" && path.isAbsolute(dir) && !excluded(dir));
	for (const dir of dirs)
		for (const candidate of candidateNames(name, context)) {
			const file = path.join(dir, candidate);
			if (!(await fs.isFile(file))) continue;
			// WindowsにはPOSIXの実行権限が無く、拡張子で実行できるかが決まる。
			if (context.platform !== "win32" && !(await fs.isExecutable(file)))
				continue;
			return file;
		}
	return undefined;
}

export async function findCommand(
	name: string,
	context: LookupContext,
): Promise<string | undefined> {
	return findIn(name, context, await excludedDirectories(context));
}

// git、ブラウザを開くcommand、nodeは.cmdと.batに解決されたら見つからないものとする。
export async function findProgram(
	name: string,
	context: LookupContext,
): Promise<string | undefined> {
	const file = await findCommand(name, context);
	return file === undefined || (context.platform === "win32" && isBatch(file))
		? undefined
		: file;
}

// npmのcmd-shimが指すscriptの絶対path（nodejs.md「npmの.cmdのshim」）。shimでなければundefined。
async function npmShimScript(
	file: string,
	fs: LookupFileSystem,
): Promise<string | undefined> {
	if (!/\.cmd$/i.test(file)) return undefined;
	const text = await fs.readSmallText(file, NPM_SHIM_MAX_BYTES);
	if (text === undefined) return undefined;
	const lines = text.split(/\r?\n/);
	if (!lines.some((line) => line.trim() === NPM_SHIM_PROG_LINE))
		return undefined;
	const launches = lines.flatMap((line) => {
		const match = NPM_SHIM_LAUNCH_LINE.exec(line);
		return match?.[1] === undefined ? [] : [match[1]];
	});
	const [script] = launches;
	if (launches.length !== 1 || script === undefined || CMD_UNSAFE.test(script))
		return undefined;
	return win32.join(win32.dirname(file), script);
}

// `#!/usr/bin/env node`の行を持つscriptか。npmのbinのscriptはこの形で、`env`はnodeをPATHから探す。
async function isEnvNodeScript(
	file: string,
	fs: LookupFileSystem,
): Promise<boolean> {
	const head = await fs.readHead(file, SHEBANG_MAX_BYTES);
	const end = head?.indexOf("\n") ?? -1;
	if (head === undefined || end < 0) return false;
	const line = head.slice(0, end).replace(/\r$/, "");
	if (!line.startsWith("#!")) return false;
	const words = line
		.slice(2)
		.split(/[ \t]+/)
		.filter(Boolean);
	const [interpreter, program] = words;
	return (
		words.length === 2 &&
		interpreter !== undefined &&
		posix.isAbsolute(interpreter) &&
		posix.basename(interpreter) === "env" &&
		program === "node"
	);
}

// correlation.md「commandの解決」のNode.jsのscript。scriptの絶対path、Node.jsのscriptでなければundefined。
async function nodeScriptFor(
	file: string,
	context: LookupContext,
): Promise<string | undefined> {
	const fs = context.fs ?? defaultFs;
	if (context.platform === "win32") return npmShimScript(file, fs);
	return (await isEnvNodeScript(file, fs)) ? file : undefined;
}

function cmdExe(
	context: LookupContext,
	excluded: Excluded,
): string | undefined {
	const usable = (file: string) =>
		win32.isAbsolute(file) && !excluded(win32.dirname(file));
	const comSpec = envValue(context.env, "ComSpec", "win32");
	if (comSpec !== undefined && usable(comSpec)) return comSpec;
	const systemRoot = envValue(context.env, "SystemRoot", "win32");
	if (systemRoot === undefined || !win32.isAbsolute(systemRoot))
		return undefined;
	if (excluded(systemRoot)) return undefined;
	const file = win32.join(systemRoot, "System32", "cmd.exe");
	return usable(file) ? file : undefined;
}

// 解決したfileを起動するcommand line。起動できなければundefined。
// quoteArgsがfalseなら（hookの`hf otel-headers`）、引数を引用符で囲まない。
export async function commandLineFor(
	file: string,
	args: readonly string[],
	context: LookupContext,
	{ quoteArgs = true }: { quoteArgs?: boolean } = {},
): Promise<CommandLine | undefined> {
	const script = await nodeScriptFor(file, context);
	if (script !== undefined)
		// shimと`env`にnodeを探させず、自身のnodeで起動する。
		return {
			file: context.execPath ?? process.execPath,
			args: [script, ...args],
			verbatim: false,
		};
	if (context.platform !== "win32" || !isBatch(file))
		return { file, args: [...args], verbatim: false };
	if ([file, ...args].some((word) => CMD_UNSAFE.test(word))) return undefined;
	const excluded = await excludedDirectories(context);
	const shell = cmdExe(context, excluded);
	if (shell === undefined) return undefined;
	const line = quoteArgs
		? [file, ...args].map((word) => `"${word}"`).join(" ")
		: [`"${file}"`, ...args].join(" ");
	// /sは最初と最後の引用符を1組取り除くため、外側にもう1組付ける。
	return { file: shell, args: ["/d", "/s", "/c", `"${line}"`], verbatim: true };
}
