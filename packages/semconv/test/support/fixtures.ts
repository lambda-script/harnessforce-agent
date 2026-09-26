export const sessionRegistration = {
	agent: "claude_code",
	session_id: "0b4c6c1e-6d7a-4a51-9f39-2f0e7f3a9c10",
	first_prompt_id: "5d2f0c3e-1111-4c7a-8e21-1f2a3b4c5d6e",
	repository: "github.com/acme/web",
	branch: "eng-42-login",
	commit: "3f786850e387550fdab836ed7e6dc881de23001b",
	issue_identifier: "ENG-42",
	source: "cli",
	started_at: "2026-09-26T09:00:00+09:00",
};

export const sessionImport = {
	...sessionRegistration,
	issue_identifier: undefined,
	source: "import",
	ended_at: "2026-09-26T01:30:00Z",
	model: "claude-opus-4-1",
	input_tokens: 120000,
	output_tokens: 8000,
	tool_calls: [
		{ tool: "Bash", calls: 12, failures: 1 },
		{ tool: "Edit", calls: 5, failures: 0 },
	],
	parser_version: "0.1.0",
};
delete (sessionImport as Record<string, unknown>).issue_identifier;

export const configSnapshot = {
	agent: "claude_code",
	session_id: sessionRegistration.session_id,
	components: [
		{
			kind: "skill",
			id: "tdd-workflow",
			version: "1.2.0",
			source: "repository",
			hash: "a".repeat(64),
		},
		{
			kind: "permissions",
			id: "project",
			source: "repository",
			hash: "b".repeat(64),
		},
		{
			kind: "mcp_server",
			id: "harnessforce",
			source: "user",
			hash: "c".repeat(64),
		},
	],
};

const measuredIntervention = {
	measurement: "measured",
	count: 3,
	wait_seconds_median: 42.5,
};
const notMeasured = {
	measurement: "not_measured",
	count: null,
	wait_seconds_median: null,
};
const loop = {
	measurement: "measured",
	occurrences: 1,
	interventions: 2,
	duration_seconds_median: 600,
};
const zeroProposal = { shown: 0, applied_detected: 0 };

export const analysisReport = {
	agent: "claude_code",
	session_id: sessionRegistration.session_id,
	first_prompt_id: sessionRegistration.first_prompt_id,
	started_at: "2026-09-26T00:00:00Z",
	analyzer_version: "0.1.0",
	parser_version: "0.1.0",
	interventions: {
		approval: notMeasured,
		continue: measuredIntervention,
		ci_relay: measuredIntervention,
		review_relay: measuredIntervention,
		answer: notMeasured,
		other: measuredIntervention,
	},
	loops: {
		issue_to_pr: loop,
		ci_fix: loop,
		review_response: loop,
		test_fix: loop,
		lint_fix: loop,
		dependency_update: {
			measurement: "not_measured",
			occurrences: null,
			interventions: null,
			duration_seconds_median: null,
		},
	},
	mcp_servers: [
		{
			server: "harnessforce",
			calls: 4,
			failures: null,
			configured: true,
			measurement: "measured",
			failures_measurement: "not_measured",
		},
		{
			server: "unlisted",
			calls: 1,
			failures: 0,
			configured: false,
			measurement: "measured",
			failures_measurement: "measured",
		},
	],
	proposals: {
		permissions: { shown: 1, applied_detected: 0 },
		hook: zeroProposal,
		skill: zeroProposal,
		rule: zeroProposal,
		agent: zeroProposal,
		command: zeroProposal,
		loop_prompt: zeroProposal,
		mcp_config: zeroProposal,
		claude_md: zeroProposal,
	},
	records_skipped: 2,
};
