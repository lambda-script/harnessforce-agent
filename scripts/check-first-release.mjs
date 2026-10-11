import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const FIRST_VERSION = "0.1.0";
const root = new URL("../", import.meta.url);

// changesetのfrontmatterの`"<name>": <bump>`の行から、対象のpackage名を読む。
export function parseChangeset(markdown) {
	const frontmatter = /^---\n([\s\S]*?)^---$/m.exec(markdown)?.[1] ?? "";
	return frontmatter
		.split("\n")
		.map((line) => /^\s*["']?([^"':]+)["']?\s*:/.exec(line)?.[1])
		.filter((name) => name !== undefined);
}

// 存在しないpackageはE404で失敗し、存在するpackageの無いversionは空の出力で終わる。それ以外の失敗は判定せずに止める。
export async function npmHasVersion(spec) {
	try {
		const { stdout } = await run("npm", ["view", spec, "version"]);
		return stdout.trim() !== "";
	} catch (error) {
		if (/E404/.test(String(error?.stderr ?? ""))) return false;
		throw error;
	}
}

/**
 * semantic-conventions.mdは、最初の公開を0.1.0とし、本体はnpmに0.1.0が載ったことで依存を切り替える。
 * changesets/actionはchangesetが残っている間はpublishせずにversionを上げるため、0.1.0が未公開のpackageへの
 * changesetと、0.1.0以外のversionを拒否する。
 * 互換の別名`hf`は最初のpublishより前のbuildだけが持つため（correlation.md「コマンド名」）、未公開のpackageの`bin`に残っていれば拒否する。
 */
export async function checkFirstRelease({ packages, changesets, isPublished }) {
	const problems = [];
	for (const { name, version, bin } of packages) {
		if (await isPublished(`${name}@${FIRST_VERSION}`)) continue;
		if (bin !== undefined && typeof bin === "object" && "hf" in bin)
			problems.push(
				`${name} exposes the hf alias, which only builds before the first publish may have (correlation.md コマンド名)`,
			);
		if (version !== FIRST_VERSION)
			problems.push(
				`${name} is ${version}, but its first release must be ${FIRST_VERSION}`,
			);
		for (const { file, names } of changesets)
			if (names.includes(name))
				problems.push(`changeset for unreleased ${name} (${file})`);
	}
	if (problems.length > 0)
		throw new Error(
			`first release would not publish ${FIRST_VERSION}:\n${problems.join("\n")}`,
		);
}

function readRepository() {
	const packages = readdirSync(new URL("packages/", root))
		.map((dir) =>
			JSON.parse(
				readFileSync(new URL(`packages/${dir}/package.json`, root), "utf8"),
			),
		)
		.filter((pkg) => !pkg.private)
		.map(({ name, version, bin }) => ({ name, version, bin }));
	const changesets = readdirSync(new URL(".changeset/", root))
		.filter((file) => file.endsWith(".md") && file !== "README.md")
		.map((file) => ({
			file,
			names: parseChangeset(
				readFileSync(new URL(`.changeset/${file}`, root), "utf8"),
			),
		}));
	return { packages, changesets };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await checkFirstRelease({ ...readRepository(), isPublished: npmHasVersion });
}
