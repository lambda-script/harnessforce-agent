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
