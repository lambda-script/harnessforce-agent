// Pure helpers for the plugin eval files: static validation and assertion evaluation over a recorded tool-call trace.

export const TOOLS = [
	"start_run",
	"get_issue",
	"record_plan",
	"record_decision",
	"complete_run",
];

const countOf = (calls, tool) => calls.filter((c) => c.tool === tool).length;
const indexOf = (calls, tool) => calls.findIndex((c) => c.tool === tool);
const textOf = (call, field) => String(call.arguments?.[field] ?? "");

// Each predicate is binary over the trace; there is no LLM judge, so a result never depends on wording.
const PREDICATES = {
	called: (a, calls) => countOf(calls, a.tool) >= (a.min ?? 1),
	not_called: (a, calls) => countOf(calls, a.tool) === 0,
	called_before: (a, calls) => {
		const first = indexOf(calls, a.first);
		const second = indexOf(calls, a.second);
		return first !== -1 && second !== -1 && first < second;
	},
	arg_excludes: (a, calls) =>
		calls
			.filter((c) => c.tool === a.tool)
			.every((c) => !textOf(c, a.field).includes(a.text)),
	arg_equals: (a, calls) =>
		calls.some((c) => c.tool === a.tool && c.arguments?.[a.field] === a.value),
};

export function evaluateAssertions(assertions, calls) {
	return assertions.map((assertion) => ({
		assertion,
		passed: PREDICATES[assertion.type](assertion, calls),
	}));
}

const toolsOf = (a) =>
	[a.tool, a.first, a.second].filter((t) => t !== undefined);

export function validateEvalFile(file) {
	const errors = [];
	const ids = new Set();
	for (const s of file.scenarios) {
		if (ids.has(s.id)) errors.push(`duplicate scenario id: ${s.id}`);
		ids.add(s.id);
		if (s.assertions.length === 0)
			errors.push(`scenario ${s.id} has no assertions`);
		for (const a of s.assertions) {
			if (!Object.hasOwn(PREDICATES, a.type))
				errors.push(`unknown assertion type: ${a.type}`);
			for (const t of toolsOf(a))
				if (!TOOLS.includes(t)) errors.push(`unknown tool: ${t}`);
		}
	}
	return errors;
}

// The stub logs bare tool names; a real server's calls arrive as mcp__<server>__<tool>, so strip the prefix.
export function parseCalls(logText) {
	return logText
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const call = JSON.parse(line);
			return { ...call, tool: call.tool.replace(/^mcp__[^_]+__/, "") };
		});
}
