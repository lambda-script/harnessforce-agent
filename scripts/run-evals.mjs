// Local, heavy: runs each scenario of a skill's eval file through `claude -p` against the stub MCP server,
// once with the working tree's plugin (candidate) and once with the plugin at a git ref (baseline).
// Run it through the /tmp/hf-heavy semaphore, one at a time. CI only checks the eval files statically.
import { execFileSync, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { evaluateAssertions, parseCalls, validateEvalFile } from "./evals.mjs";

const repo = fileURLToPath(new URL("../", import.meta.url));
const stub = fileURLToPath(new URL("./stub-mcp.mjs", import.meta.url));

function runScenario(pluginDir, scenario, work) {
	const log = join(work, `${scenario.id}.jsonl`);
	const config = join(work, `${scenario.id}.mcp.json`);
	writeFileSync(
		config,
		JSON.stringify({
			mcpServers: {
				harnessforce: {
					command: process.execPath,
					args: [stub],
					env: { HF_EVAL_CALL_LOG: log },
				},
			},
		}),
	);
	const cwd = join(work, `cwd-${scenario.id}`);
	mkdirSync(cwd);
	spawnSync(
		"claude",
		[
			"-p",
			scenario.prompt,
			"--plugin-dir",
			pluginDir,
			"--mcp-config",
			config,
			"--strict-mcp-config",
			"--allowedTools",
			"mcp__harnessforce__*",
			"--append-system-prompt",
			scenario.context,
		],
		{ cwd, stdio: "ignore", timeout: 300_000 },
	);
	const calls = existsSync(log) ? parseCalls(readFileSync(log, "utf8")) : [];
	return evaluateAssertions(scenario.assertions, calls);
}

function main() {
	const { values } = parseArgs({
		options: {
			skill: { type: "string" },
			"baseline-ref": { type: "string", default: "origin/main" },
		},
	});
	if (!values.skill) throw new Error("--skill <name> is required");
	const file = JSON.parse(
		readFileSync(join(repo, "evals", `${values.skill}.json`), "utf8"),
	);
	const errors = validateEvalFile(file);
	if (errors.length > 0) throw new Error(errors.join("\n"));

	const work = mkdtempSync(join(tmpdir(), "hf-evals-"));
	try {
		const baseline = join(work, "baseline");
		mkdirSync(baseline);
		const archive = execFileSync(
			"git",
			["-C", repo, "archive", values["baseline-ref"], "plugins/harnessforce"],
			{ maxBuffer: 64 * 1024 * 1024 },
		);
		execFileSync("tar", ["-x", "-C", baseline], { input: archive });
		const variants = {
			baseline: join(baseline, "plugins/harnessforce"),
			candidate: join(repo, "plugins/harnessforce"),
		};
		for (const [name, dir] of Object.entries(variants)) {
			let passed = 0;
			let total = 0;
			for (const scenario of file.scenarios) {
				const results = runScenario(dir, scenario, work);
				const failed = results.filter((r) => !r.passed);
				passed += results.length - failed.length;
				total += results.length;
				for (const f of failed)
					console.log(
						`  ${name} ${scenario.id}: FAIL ${JSON.stringify(f.assertion)}`,
					);
			}
			console.log(`${name}: ${passed}/${total} assertions passed`);
		}
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

main();
