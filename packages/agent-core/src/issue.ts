// session registrationの`issue_identifier`とhf runの`--issue`の制約（semantic-conventions.md token(300)）。
const ISSUE_IDENTIFIER = /^\S{1,300}$/;

export const isIssueIdentifier = (value: string) =>
	ISSUE_IDENTIFIER.test(value);
