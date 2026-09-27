import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

/** root package.jsonのconfig.npmScopeを、各packageの名前、内部依存、READMEへ反映する。 */
export function applyScope(rootDir) {
	const nextScope = readJson(join(rootDir, "package.json")).config.npmScope;
	const dirs = readdirSync(join(rootDir, "packages"));
	const currentScope = readJson(
		join(rootDir, "packages", dirs[0], "package.json"),
	).name.split("/")[0];
	if (currentScope === nextScope) return;

	const rename = (name) =>
		name.startsWith(`${currentScope}/`)
			? `${nextScope}/${name.slice(currentScope.length + 1)}`
			: name;
	for (const dir of dirs) {
		const file = join(rootDir, "packages", dir, "package.json");
		const pkg = readJson(file);
		const next = { ...pkg, name: rename(pkg.name) };
		for (const field of [
			"dependencies",
			"devDependencies",
			"peerDependencies",
		]) {
			if (pkg[field])
				next[field] = Object.fromEntries(
					Object.entries(pkg[field]).map(([k, v]) => [rename(k), v]),
				);
		}
		writeJson(file, next);
	}
	const readme = join(rootDir, "README.md");
	writeFileSync(
		readme,
		readFileSync(readme, "utf8").replaceAll(
			`${currentScope}/`,
			`${nextScope}/`,
		),
	);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
	applyScope(process.cwd());
