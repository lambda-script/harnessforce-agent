import { SessionImportSchema } from "@harnessforce/semconv";
import { Ajv } from "ajv";
import { fullFormats } from "ajv-formats/dist/formats.js";

// 公開するschemaで、送る要素を検証する。
const ajv = new Ajv({ strict: true, allErrors: true });
ajv.addFormat("date-time", fullFormats["date-time"]);
export const isSessionImport = ajv.compile(
	JSON.parse(JSON.stringify(SessionImportSchema)),
);
