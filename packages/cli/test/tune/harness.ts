import {
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { createImportGit } from "../../src/import/repository.js";
import type { CliDeps } from "../../src/main.js";
import {
	gitRepository,
	initializedHome,
	initializedKeychain,
	NOW,
	startImportServer,
} from "../import/harness.js";
import { runCli } from "../support/cli.js";

export { NOW };
export const MARKER = "MARKER-7f3c9e2a-do-not-send";
const DAY_MS = 86_400_000;

const line = (value: unknown) => `${JSON.stringify(value)}\n`;

// promptに目印の文字列を含むsession。開始から1分後に内容の無い続行の指示が1回ある。
export function tuneTranscript(
	sessionId: string,
	cwd: string,
	startedAtMs: number,
	extraRows: unknown[] = [],
): string {
	const at = (seconds: number) =>
		new Date(startedAtMs + seconds * 1000).toISOString();
	const base = { sessionId, cwd, gitBranch: "main" };
	return [
		{
			...base,
			type: "user",
			promptId: `prompt-${sessionId}`,
			timestamp: at(0),
			message: { role: "user", content: `please fix ${MARKER}` },
		},
		{
			...base,
			type: "assistant",
			timestamp: at(1),
			message: {
				id: `m1-${sessionId}`,
				model: "claude-opus-5-5",
				usage: { input_tokens: 1, output_tokens: 1 },
				content: [{ type: "text", text: `ok ${MARKER}` }],
			},
		},
		{
			...base,
			type: "user",
			timestamp: at(60),
			message: { role: "user", content: "continue" },
		},
		...extraRows.map((row) => ({ ...base, ...(row as object) })),
		{
			...base,
			type: "assistant",
			timestamp: at(61),
			message: {
				id: `m2-${sessionId}`,
				model: "claude-opus-5-5",
				usage: { input_tokens: 1, output_tokens: 1 },
				content: [{ type: "text", text: "done" }],
			},
		},
	]
		.map(line)
		.join("");
}

type SetupOptions = Parameters<typeof startImportServer>[0] & {
	sessions?: number;
	// 各sessionの開始（NOWからの日数）。無ければ2日前。
	startedDaysAgo?: (index: number) => number;
	remote?: string;
};

export async function setupTune(options: SetupOptions = {}) {
	const hf = await startImportServer(options);
	const cwd = gitRepository(options.remote);
	const count = options.sessions ?? 10;
	const sessions = Object.fromEntries(
		Array.from({ length: count }, (_, i) => {
			const id = `s${String(i).padStart(3, "0")}`;
			const days = options.startedDaysAgo?.(i) ?? 2;
			return [id, tuneTranscript(id, cwd, NOW - days * DAY_MS + i * 1000)];
		}),
	);
	const home = initializedHome(
		{
			HARNESSFORCE_URL: hf.appUrl,
			HARNESSFORCE_ENDPOINT: `${hf.ingestUrl}/`,
			HARNESSFORCE_WORKSPACE_ID: "ws1",
		},
		sessions,
	);
	const keychain = initializedKeychain(hf.origin);
	const tuneDir = join(home.home, ".harnessforce", "tune");
	const run = (args: string[] = [], deps: Partial<CliDeps> = {}) =>
		runCli(["tune", ...args], {
			defaultUrl: "https://default.example.test",
			now: () => new Date(NOW),
			homeDir: home.home,
			keychain: keychain.keychain,
			importGit: createImportGit(process.platform, process.env, process.cwd()),
			...deps,
		});
	const reportBodies = () =>
		hf.requests
			.filter((r) => r.path === "POST /ingest/v1/analysis-reports")
			.map((r) => r.body as Record<string, unknown>[]);
	const readTune = (name: string) =>
		JSON.parse(readFileSync(join(tuneDir, name), "utf8"));
	return { hf, cwd, home, keychain, tuneDir, run, reportBodies, readTune };
}

// directoryの下のfileの内容（相対pathごと）。変わっていないことを確かめる。
export function snapshotTree(
	root: string,
	exclude: (path: string) => boolean = () => false,
): Record<string, string> {
	const files: Record<string, string> = {};
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir)) {
			const path = join(dir, entry);
			const rel = relative(root, path);
			if (exclude(rel)) continue;
			if (statSync(path).isDirectory()) walk(path);
			else files[rel] = readFileSync(path, "latin1");
		}
	};
	walk(root);
	return files;
}

export function writeFile(path: string, content: string) {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, content);
}
