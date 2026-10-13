export const VIEW_ATTEMPTS: number;
export const VIEW_INTERVAL_MS: number;
export function npmView(
	spec: string,
	options?: {
		attempts?: number;
		intervalMs?: number;
		viewOnce?: (spec: string) => Promise<string>;
		wait?: (ms: number) => Promise<void>;
	},
): Promise<string>;
export function verifyPublished(
	published: readonly { name: string; version: string }[],
	view?: (spec: string) => Promise<string>,
): Promise<void>;
