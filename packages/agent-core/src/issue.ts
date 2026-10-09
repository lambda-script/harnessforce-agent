import { isToken } from "@harnessforce/semconv";

// session registrationの`issue_identifier`とharnessforce runの`--issue`の制約（semantic-conventions.md token(300)）。
export const isIssueIdentifier = (value: string) => isToken(value, 300);
