export const ATTR = {
	workspaceId: "hf.workspace.id",
	projectId: "hf.project.id",
	projectKey: "hf.project.key",
	milestoneId: "hf.milestone.id",
	cycleId: "hf.cycle.id",
	issueId: "hf.issue.id",
	issueIdentifier: "hf.issue.identifier",
	planId: "hf.plan.id",
	planVersion: "hf.plan.version",
	agentConfigVersion: "hf.agent.config_version",
	executionMode: "hf.execution.mode",
	executionActorType: "hf.execution.actor_type",
	executionActorId: "hf.execution.actor_id",
	vcsRepository: "hf.vcs.repository",
	vcsBranch: "hf.vcs.branch",
	vcsCommit: "hf.vcs.commit",
	sdkName: "hf.sdk.name",
	sdkVersion: "hf.sdk.version",
} as const;

export type AttributeName = (typeof ATTR)[keyof typeof ATTR];

export const EXECUTION_MODES = ["human", "ai", "hybrid"] as const;
export const EXECUTION_ACTOR_TYPES = [
	"user",
	"agent",
	"integration",
	"system",
] as const;
