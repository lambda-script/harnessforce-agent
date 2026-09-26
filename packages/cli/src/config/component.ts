// semantic-conventions.md「Config snapshot」のcomponent。@harnessforce/semconvのConfigSnapshotSchemaと同じ形を保つ（testで照合する）。
export type ComponentKind =
	| "skill"
	| "rule"
	| "agent"
	| "command"
	| "hook"
	| "permissions"
	| "mcp_server"
	| "model"
	| "workflow";
export type ComponentSource =
	| "managed"
	| "user"
	| "repository"
	| "local"
	| "plugin";

export type ConfigComponent = {
	kind: ComponentKind;
	id: string;
	version?: string;
	hash: string;
	source: ComponentSource;
};
