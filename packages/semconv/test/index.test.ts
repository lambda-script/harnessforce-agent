import { readFileSync } from "node:fs";
import { compileSchema } from "@harnessforce/test-support/validator";
import { describe, expect, it } from "vitest";
import * as semconv from "../src/index.js";
import * as fx from "./support/fixtures.js";

const examples: Record<keyof typeof semconv.SCHEMAS, unknown> = {
	"session-registration": fx.sessionRegistration,
	"session-import": fx.sessionImport,
	"config-snapshot": fx.configSnapshot,
	"analysis-report": fx.analysisReport,
	"ingest-issue": fx.ingestIssue,
	"ingest-event": fx.ingestEvent,
};

describe("public entry", () => {
	it.each(
		Object.entries(semconv.SCHEMAS),
	)("%s works as plain JSON Schema with a major-scoped $id", (name, schema) => {
		const json = JSON.parse(JSON.stringify(schema));
		expect(json.$id).toBe(
			`urn:harnessforce:semconv:${semconv.SEMCONV_MAJOR}:${name}`,
		);
		expect(compileSchema(json)(examples[name as keyof typeof examples])).toBe(
			true,
		);
	});

	it("keeps SEMCONV_MAJOR in sync with the package major", () => {
		const pkg = JSON.parse(
			readFileSync(new URL("../package.json", import.meta.url), "utf8"),
		);
		expect(Number(pkg.version.split(".")[0])).toBe(semconv.SEMCONV_MAJOR);
	});

	it("re-exports attributes", () =>
		expect(semconv.ATTR.issueIdentifier).toBe("hf.issue.identifier"));
});
