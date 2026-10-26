// Stub of the Harnessforce MCP server for evals: answers the handshake, serves the three record-run tools
// and appends every call to the file named by HF_EVAL_CALL_LOG. It never reaches a network.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { TOOLS } from "./evals.mjs";

const log = process.env.HF_EVAL_CALL_LOG;
const RESULTS = {
	start_run: { run_id: "run-eval-1" },
	get_issue: {
		identifier: "ENG-42",
		title: "Eval issue",
	},
	complete_run: { status: "completed" },
};

const reply = (id, result) =>
	process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);

const handlers = {
	initialize: (id) =>
		reply(id, {
			protocolVersion: "2025-06-18",
			capabilities: { tools: {} },
			serverInfo: { name: "harnessforce", version: "eval-stub" },
		}),
	"tools/list": (id) =>
		reply(id, {
			tools: TOOLS.map((name) => ({
				name,
				description: `Stub of ${name}`,
				inputSchema: { type: "object", additionalProperties: true },
			})),
		}),
	"tools/call": (id, params) => {
		if (log)
			appendFileSync(
				log,
				`${JSON.stringify({ tool: params.name, arguments: params.arguments })}\n`,
			);
		reply(id, {
			content: [{ type: "text", text: JSON.stringify(RESULTS[params.name]) }],
		});
	},
};

createInterface({ input: process.stdin }).on("line", (line) => {
	const message = JSON.parse(line);
	handlers[message.method]?.(message.id, message.params);
});
