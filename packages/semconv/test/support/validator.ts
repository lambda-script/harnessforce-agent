import { Ajv } from "ajv";
import { fullFormats } from "ajv-formats/dist/formats.js";

export function compile(schema: unknown) {
	const ajv = new Ajv({ strict: true, allErrors: true });
	ajv.addFormat("date-time", fullFormats["date-time"]);
	ajv.addFormat("date", fullFormats.date);
	ajv.addFormat("uri", fullFormats.uri);
	const validate = ajv.compile(JSON.parse(JSON.stringify(schema)));
	return (value: unknown) => validate(value);
}
