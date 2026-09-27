import { AnalysisReportSchema } from "./schemas/analysis-report.js";
import { ConfigSnapshotSchema } from "./schemas/config-snapshot.js";
import {
	IngestEventSchema,
	IngestIssueSchema,
} from "./schemas/ingest-items.js";
import { SessionImportSchema } from "./schemas/session-import.js";
import { SessionRegistrationSchema } from "./schemas/session-registration.js";

export * from "./attributes.js";
export * from "./schemas/analysis-report.js";
export { SEMCONV_MAJOR, schemaId } from "./schemas/common.js";
export * from "./schemas/config-snapshot.js";
export * from "./schemas/ingest-items.js";
export * from "./schemas/session-import.js";
export {
	REGISTRATION_SOURCES,
	type SessionRegistration,
	SessionRegistrationSchema,
} from "./schemas/session-registration.js";

// 利用側はこの一覧から、自分のvalidatorでschemaをcompileする。Workers上ではコード生成を伴わないvalidatorを選ぶ。
export const SCHEMAS = {
	"session-registration": SessionRegistrationSchema,
	"session-import": SessionImportSchema,
	"config-snapshot": ConfigSnapshotSchema,
	"analysis-report": AnalysisReportSchema,
	"ingest-issue": IngestIssueSchema,
	"ingest-event": IngestEventSchema,
} as const;
