export type EvalAssertion = { type: string; [key: string]: unknown };
export type EvalCall = { tool: string; arguments?: Record<string, unknown> };
export type EvalScenario = {
	id: string;
	prompt: string;
	context: string;
	assertions: EvalAssertion[];
};
export type EvalFile = { skill: string; scenarios: EvalScenario[] };
export const TOOLS: readonly string[];
export function evaluateAssertions(
	assertions: readonly EvalAssertion[],
	calls: readonly EvalCall[],
): { assertion: EvalAssertion; passed: boolean }[];
export function validateEvalFile(file: EvalFile): string[];
export function parseCalls(logText: string): EvalCall[];
