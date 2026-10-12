import { execFileSync, spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// turboはtestの前にこのpackageのbuildを実行する。直接vitestを実行する場合は先に`pnpm build`する。
const packageDir = fileURLToPath(new URL("..", import.meta.url));
const tsc = join(
	dirname(createRequire(import.meta.url).resolve("typescript/package.json")),
	"bin/tsc",
);
const consumer = mkdtempSync(join(tmpdir(), "hf-semconv-consumer-"));
afterAll(() => rmSync(consumer, { recursive: true, force: true }));

// 公開する型の一覧。どれかがanyへ劣化すると、利用側の型検査は黙って通ってしまう。
const PUBLIC_TYPES = [
	"AnalysisReport",
	"AttributeName",
	"ConfigSnapshot",
	"IngestEvent",
	"IngestIssue",
	"SessionImport",
	"SessionRegistration",
	"SessionUsageSummary",
];

const fixture = `import {
	${PUBLIC_TYPES.map((name) => `type ${name},`).join("\n\t")}
	normalizeRepository,
	SCHEMAS,
} from "@harnessforce/semconv";

type IsAny<T> = 0 extends 1 & T ? true : false;
type NotAny<T> = IsAny<T> extends true ? never : T;

${PUBLIC_TYPES.map((name) => `export const is${name}Typed: IsAny<${name}> = false;`).join("\n")}
export const isSchemasTyped: IsAny<(typeof SCHEMAS)["session-registration"]> = false;
export const isNormalizeTyped: IsAny<typeof normalizeRepository> = false;

export const sessionId: NotAny<SessionRegistration["session_id"]> = "s-1";
// @ts-expect-error session_idは文字列である。
export const wrongSessionId: SessionRegistration["session_id"] = 1;
`;

// npmへ公開するtarballを、利用者と同じようにnode_modulesから読む。
function installPacked(): void {
	const packs = join(consumer, "packs");
	execFileSync("pnpm", ["pack", "--pack-destination", packs], {
		cwd: packageDir,
		stdio: "ignore",
	});
	const [tarball] = readdirSync(packs);
	const installed = join(consumer, "node_modules/@harnessforce/semconv");
	mkdirSync(installed, { recursive: true });
	execFileSync("tar", [
		"-xzf",
		join(packs, tarball as string),
		"-C",
		installed,
		"--strip-components=1",
	]);
	const typebox = join(consumer, "node_modules/@sinclair/typebox");
	mkdirSync(dirname(typebox), { recursive: true });
	symlinkSync(
		realpathSync(join(packageDir, "node_modules/@sinclair/typebox")),
		typebox,
	);
}

describe("packed @harnessforce/semconv", () => {
	it("gives a consumer its public types, not any", () => {
		installPacked();
		writeFileSync(join(consumer, "index.ts"), fixture);
		writeFileSync(
			join(consumer, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					module: "NodeNext",
					moduleResolution: "NodeNext",
					strict: true,
					noEmit: true,
					// 公開物のdeclarationの誤りは、ここでは型の劣化としてだけ現れる。
					skipLibCheck: true,
					types: [],
				},
				files: ["index.ts"],
			}),
		);
		writeFileSync(
			join(consumer, "package.json"),
			JSON.stringify({ type: "module" }),
		);
		const checked = spawnSync(process.execPath, [tsc, "-p", consumer], {
			encoding: "utf8",
		});
		expect({ status: checked.status, stdout: checked.stdout }).toEqual({
			status: 0,
			stdout: "",
		});
	}, 30_000);
});
