import { Ajv } from "ajv";
import { fullFormats } from "ajv-formats/dist/formats.js";

// 送る要素と公開するschemaを、利用側と同じくJSON Schemaとしてstrictにcompileして確かめる。
// 同じ$idのschemaを2度compileできないため、schemaごとにAjvを作る。
export function compileSchema(schema: unknown): (value: unknown) => boolean {
	const ajv = new Ajv({ strict: true, allErrors: true });
	ajv.addFormat("date-time", fullFormats["date-time"]);
	ajv.addFormat("date", fullFormats.date);
	ajv.addFormat("uri", fullFormats.uri);
	const validate = ajv.compile(JSON.parse(JSON.stringify(schema)));
	return (value) => validate(value);
}
