export function npmView(spec: string): Promise<string>;
export function verifyPublished(
	published: readonly { name: string; version: string }[],
	view?: (spec: string) => Promise<string>,
): Promise<void>;
