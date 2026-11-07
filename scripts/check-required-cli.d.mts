export type Invocation = { command: string[]; options: string[] };
export function collectInvocations(sources: {
	markdown: readonly string[];
	hookSources: readonly string[];
	scriptSources: readonly string[];
}): Invocation[];
export function pluginInvocations(): Invocation[];
export function checkRequiredCli(
	requiredVersion: string | undefined,
	invocations: readonly Invocation[],
	run: (args: string[]) => Promise<{ code: number; stdout: string }>,
): Promise<string[]>;
export function isNewerVersion(a: string, b: string): boolean;
