import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCliDestinations } from "../src/destinations.js";
import { tempDir } from "./config/support.js";

const DEFAULT_URL = "https://app.example.test";

function settingsFile(content: unknown): string {
	const path = join(tempDir("hf-settings-"), "settings.json");
	writeFileSync(
		path,
		typeof content === "string" ? content : JSON.stringify(content),
	);
	return path;
}

const missingSettings = "/nonexistent/hf-settings/settings.json";

describe("resolveCliDestinations", () => {
	it("prefers the shell over user settings over the build default", async () => {
		const path = settingsFile({
			env: {
				HARNESSFORCE_URL: "https://settings.example.test/app",
				HARNESSFORCE_ENDPOINT: "https://ingest.settings.test",
				HARNESSFORCE_WORKSPACE_ID: "ws-settings",
			},
		});
		expect(await resolveCliDestinations({}, path, DEFAULT_URL)).toEqual({
			readApiUrl: "https://settings.example.test/app",
			ingestEndpoint: "https://ingest.settings.test",
			workspaceId: "ws-settings",
		});
		expect(
			await resolveCliDestinations(
				{
					HARNESSFORCE_URL: "https://shell.example.test",
					HARNESSFORCE_ENDPOINT: "https://ingest.shell.test/base",
					HARNESSFORCE_WORKSPACE_ID: "ws-shell",
				},
				path,
				DEFAULT_URL,
			),
		).toEqual({
			readApiUrl: "https://shell.example.test",
			ingestEndpoint: "https://ingest.shell.test/base",
			workspaceId: "ws-shell",
		});
	});

	it("falls back to the build default for the Read API only", async () =>
		expect(
			await resolveCliDestinations({}, missingSettings, DEFAULT_URL),
		).toEqual({
			readApiUrl: DEFAULT_URL,
			ingestEndpoint: undefined,
			workspaceId: undefined,
		}));

	// schemeの規則は呼び出し側が確かめる順（correlation.md「CLI」）で検査する。
	it("returns the values without checking the scheme", async () =>
		expect(
			await resolveCliDestinations(
				{
					HARNESSFORCE_URL: "http://app.example.test",
					HARNESSFORCE_ENDPOINT: "not a url",
				},
				missingSettings,
				DEFAULT_URL,
			),
		).toMatchObject({
			readApiUrl: "http://app.example.test",
			ingestEndpoint: "not a url",
		}));

	it("treats an empty shell value as absent", async () =>
		expect(
			await resolveCliDestinations(
				{ HARNESSFORCE_WORKSPACE_ID: "" },
				settingsFile({ env: { HARNESSFORCE_WORKSPACE_ID: "ws-settings" } }),
				DEFAULT_URL,
			),
		).toMatchObject({ workspaceId: "ws-settings" }));

	it.each([
		["not json"],
		[[]],
		[{ env: "x" }],
	])("treats unreadable user settings (%j) as having no values", async (content) =>
		expect(
			await resolveCliDestinations({}, settingsFile(content), DEFAULT_URL),
		).toEqual({
			readApiUrl: DEFAULT_URL,
			ingestEndpoint: undefined,
			workspaceId: undefined,
		}));

	it("ignores non-string settings values", async () =>
		expect(
			await resolveCliDestinations(
				{},
				settingsFile({ env: { HARNESSFORCE_ENDPOINT: 1 } }),
				DEFAULT_URL,
			),
		).toMatchObject({ ingestEndpoint: undefined }));
});
