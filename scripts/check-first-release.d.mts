type Package = {
	name: string;
	version: string;
	bin?: Readonly<Record<string, string>> | string;
};
type Changeset = { file: string; names: readonly string[] };

export function parseChangeset(markdown: string): string[];
export function npmHasVersion(spec: string): Promise<boolean>;
export function checkFirstRelease(input: {
	packages: readonly Package[];
	changesets: readonly Changeset[];
	isPublished: (spec: string) => Promise<boolean>;
}): Promise<void>;
