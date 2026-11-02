// client-updates.md「pluginが必要とするCLIの版」: REQUIRED_CLI_VERSIONのCLIが、pluginの起動するcommandとoptionをすべて持つことを確かめる。
// 上げ忘れると、古いCLIの端末でsetupやhookが途中で失敗する。CIはnpmからその版を入れ、`--help`だけを起動する（何も書かず、何も送らない）。
import { execFile } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const pluginDir = fileURLToPath(
	new URL("../plugins/harnessforce/", import.meta.url),
);

// 過去のCLIが利用者の設定へ書いたcommand。pluginはsetupで言及するだけで起動しない。
const RETIRED_COMMANDS = new Set(["usage-limits"]);

const COMMAND_WORD = /^[a-z][a-z-]*$/;
const SHELL_OPERATOR = /^(\||;|&|>|<<)/;

/**
 * `harnessforce <command...> [--option [value]...]`の1行を読む。commandでもoptionでもない語で始まる行はundefined。
 * optionの値やplaceholderは読み飛ばし、`--`やshellの演算子（pipe、redirect、heredoc）で止まる。
 */
function parseInvocation(line) {
	const [head, ...tokens] = line.trim().split(/\s+/);
	if (head !== "harnessforce") return undefined;
	const command = [];
	const options = [];
	for (const token of tokens) {
		if (token === "--" || SHELL_OPERATOR.test(token)) break;
		if (token.startsWith("--")) options.push(token.split("=")[0]);
		else if (COMMAND_WORD.test(token) && options.length === 0)
			command.push(token);
		else if (command.length === 0 && options.length === 0) return undefined;
	}
	if (command.length === 0 && options.length === 0) return undefined;
	if (RETIRED_COMMANDS.has(command[0])) return undefined;
	return { command, options };
}

function invocationLines(markdown) {
	const lines = [];
	const prose = markdown.replace(
		/```[a-z]*\n([\s\S]*?)```/g,
		(_block, body) => {
			lines.push(...body.split("\n"));
			return "";
		},
	);
	for (const [, code] of prose.matchAll(/`([^`\n]+)`/g)) lines.push(code);
	return lines;
}

const stringLiterals = (code) =>
	[...code.matchAll(/"([^"]*)"/g)].map(([, literal]) => literal);

// hookは`run(cwd, [...])`でharnessforceを起動する（plugins/harnessforce/src/user-key.ts）。
function hookLines(source) {
	return [...source.matchAll(/\brun\(\s*\w+,\s*\[([^\]]*)\],?\s*\)/g)].map(
		([, args]) => `harnessforce ${stringLiterals(args).join(" ")}`,
	);
}

// skillのscriptは`spawnSync("harnessforce", [...])`で起動し、利用者の引数のうちALLOWED_FLAGSに許したものだけを足して渡す
// （skills/propose-improvements/scripts/summarize.mjs）。足すoptionは変数にあるため、その定義から読む。
function scriptLines(source) {
	const forwarded = stringLiterals(
		/\bALLOWED_FLAGS = new Set\(\[([^\]]*)\]\)/.exec(source)?.[1] ?? "",
	);
	return [
		...source.matchAll(/\bspawnSync\(\s*"harnessforce",\s*\[([^\]]*)\]/g),
	].map(
		([, args]) =>
			`harnessforce ${[...stringLiterals(args), ...forwarded].join(" ")}`,
	);
}

/** 同じcommandのoptionを1つにまとめ、command順に並べる。 */
export function collectInvocations({ markdown, hookSources, scriptSources }) {
	const byCommand = new Map();
	const lines = [
		...markdown.flatMap(invocationLines),
		...hookSources.flatMap(hookLines),
		...scriptSources.flatMap(scriptLines),
	];
	for (const invocation of lines.map(parseInvocation)) {
		if (!invocation) continue;
		const key = invocation.command.join(" ");
		const options = byCommand.get(key)?.options ?? new Set();
		for (const option of invocation.options) options.add(option);
		byCommand.set(key, { command: invocation.command, options });
	}
	return [...byCommand.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, { command, options }]) => ({
			command,
			options: [...options].sort(),
		}));
}

const filesUnder = (dir, suffix) =>
	readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
		.map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"));

/** pluginのcommand、skill、hookが起動するharnessforceのcommandとoption。 */
export function pluginInvocations() {
	return collectInvocations({
		markdown: [
			...filesUnder(join(pluginDir, "commands"), ".md"),
			...filesUnder(join(pluginDir, "skills"), ".md"),
		].map((text) => text.replaceAll("\r\n", "\n")),
		hookSources: filesUnder(join(pluginDir, "src"), ".ts"),
		scriptSources: filesUnder(join(pluginDir, "skills"), ".mjs"),
	});
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (help, word) =>
	new RegExp(`(?<![\\w-])${escapeRegExp(word)}(?![\\w-])`).test(help);

/** `run(args)`でCLIを起動し、見つかった問題を返す。空なら合格。 */
export async function checkRequiredCli(requiredVersion, invocations, run) {
	const problems = [];
	const version = (await run(["--version"])).stdout.trim();
	if (version !== requiredVersion)
		problems.push(
			`harnessforce --version printed ${version}, not ${requiredVersion}`,
		);
	for (const { command, options } of invocations) {
		const args = [...command, "--help"];
		const shown = `harnessforce ${args.join(" ")}`;
		const { code, stdout } = await run(args);
		if (code !== 0) {
			problems.push(`${shown} exited with ${code}`);
			continue;
		}
		const words = [
			...(command.length > 0 ? [`harnessforce ${command.join(" ")}`] : []),
			...options,
		];
		for (const word of words)
			if (!mentions(stdout, word))
				problems.push(`${shown} does not mention ${word}`);
	}
	return problems;
}

const execFileAsync = promisify(execFile);

async function main() {
	const { REQUIRED_CLI_VERSION } = await import(
		new URL(
			"../plugins/harnessforce/src/required-cli-version.ts",
			import.meta.url,
		).href
	);
	const work = mkdtempSync(join(tmpdir(), "hf-required-cli-"));
	try {
		await execFileAsync("npm", [
			"install",
			"--prefix",
			work,
			"--no-audit",
			"--no-fund",
			"--ignore-scripts",
			`@harnessforce/cli@${REQUIRED_CLI_VERSION}`,
		]);
		const cliDir = join(work, "node_modules/@harnessforce/cli");
		const { bin } = JSON.parse(
			readFileSync(join(cliDir, "package.json"), "utf8"),
		);
		const binPath = join(
			cliDir,
			typeof bin === "string" ? bin : bin.harnessforce,
		);
		// 空のHOMEで起動し、端末の設定とkeychainに触れない。
		const home = join(work, "home");
		mkdirSync(home);
		const env = { PATH: process.env.PATH, HOME: home };
		const run = (args) =>
			execFileAsync(process.execPath, [binPath, ...args], { env }).then(
				({ stdout }) => ({ code: 0, stdout }),
				(error) => ({ code: error.code ?? 1, stdout: error.stdout ?? "" }),
			);
		const invocations = pluginInvocations();
		const problems = await checkRequiredCli(
			REQUIRED_CLI_VERSION,
			invocations,
			run,
		);
		if (problems.length > 0) {
			for (const problem of problems) console.error(problem);
			process.exitCode = 1;
			return;
		}
		console.log(
			`CLI ${REQUIRED_CLI_VERSION} has the ${invocations.length} commands the plugin runs`,
		);
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
