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
			kind: "resolved",
			readApiBase: new URL("https://settings.example.test/app"),
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
			kind: "resolved",
			readApiBase: new URL("https://shell.example.test"),
			ingestEndpoint: "https://ingest.shell.test/base",
			workspaceId: "ws-shell",
		});
	});

	it("falls back to the build default for the Read API only", async () => {
		const r = await resolveCliDestinations(
			{
				HARNESSFORCE_ENDPOINT: "https://ingest.shell.test",
				HARNESSFORCE_WORKSPACE_ID: "ws1",
			},
			missingSettings,
			DEFAULT_URL,
		);
		expect(r).toMatchObject({ readApiBase: new URL(DEFAULT_URL) });
	});

	it("asks for hf init without an ingest endpoint", async () =>
		expect(
			await resolveCliDestinations(
				{ HARNESSFORCE_WORKSPACE_ID: "ws1" },
				settingsFile({ env: { HARNESSFORCE_URL: "https://a.test" } }),
				DEFAULT_URL,
			),
		).toEqual({ kind: "initRequired" }));

	it("asks for hf init without a workspace", async () =>
		expect(
			await resolveCliDestinations(
				{ HARNESSFORCE_ENDPOINT: "https://ingest.test" },
				missingSettings,
				DEFAULT_URL,
			),
		).toEqual({ kind: "initRequired" }));

	it.each([
		[{ HARNESSFORCE_URL: "http://app.example.test" }],
		[{ HARNESSFORCE_ENDPOINT: "http://ingest.example.test" }],
		[{ HARNESSFORCE_ENDPOINT: "not a url" }],
	])("rejects a destination that breaks the scheme rule (%j)", async (env) =>
		expect(
			await resolveCliDestinations(
				{
					HARNESSFORCE_ENDPOINT: "https://ingest.test",
					HARNESSFORCE_WORKSPACE_ID: "ws1",
					...env,
				},
				missingSettings,
				DEFAULT_URL,
			),
		).toEqual({ kind: "invalidUrl" }));

	it("allows http for loopback hosts", async () =>
		expect(
			await resolveCliDestinations(
				{
					HARNESSFORCE_URL: "http://127.0.0.1:3000",
					HARNESSFORCE_ENDPOINT: "http://localhost:4318",
					HARNESSFORCE_WORKSPACE_ID: "ws1",
				},
				missingSettings,
				DEFAULT_URL,
			),
		).toMatchObject({ kind: "resolved" }));

	it.each([
		["not json"],
		[[]],
		[{ env: "x" }],
	])("treats unreadable user settings (%j) as having no values", async (content) =>
		expect(
			await resolveCliDestinations(
				{ HARNESSFORCE_WORKSPACE_ID: "ws1" },
				settingsFile(content),
				DEFAULT_URL,
			),
		).toEqual({ kind: "initRequired" }));

	it("ignores non-string settings values", async () =>
		expect(
			await resolveCliDestinations(
				{ HARNESSFORCE_WORKSPACE_ID: "ws1" },
				settingsFile({ env: { HARNESSFORCE_ENDPOINT: 1 } }),
				DEFAULT_URL,
			),
		).toEqual({ kind: "initRequired" }));
});
