import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	type ClientIdentity,
	parseClientUpdateHeader,
	readUpdateState,
	recheckClientStatus,
	recordingFetch,
	shouldShowOutdated,
	type UpdateState,
	updateLine,
	userAgentOf,
	writeUpdateState,
} from "../src/client-update.js";

// client-updates.md 版の申告、clientの扱い。

const CLI: ClientIdentity = { component: "cli", version: "0.2.0", dev: false };
const NOW = new Date("2026-11-01T12:00:00Z");

const tempPath = async () =>
	join(await mkdtemp(join(tmpdir(), "hf-update-")), "update-status.json");

const state = (overrides: Partial<UpdateState> = {}): UpdateState => ({
	version: "0.2.0",
	status: "current",
	receivedAt: NOW.toISOString(),
	...overrides,
});

describe("userAgentOf", () => {
	it("names the component and version, with -dev for builds given a destination", () => {
		expect(userAgentOf(CLI)).toBe("harnessforce-cli/0.2.0");
		expect(
			userAgentOf({
				component: "claude-code-plugin",
				version: "1.0.0",
				dev: true,
			}),
		).toBe("harnessforce-claude-code-plugin-dev/1.0.0");
	});
});

describe("parseClientUpdateHeader", () => {
	it("reads the RFC 9651 dictionary members", () => {
		expect(parseClientUpdateHeader("status=current")).toEqual({
			status: "current",
		});
		expect(
			parseClientUpdateHeader(
				'status=deprecated, latest="0.3.0", reason=security, deadline=@1762041600',
			),
		).toEqual({
			status: "deprecated",
			latest: "0.3.0",
			reason: "security",
			deadline: "2025-11-02T00:00:00.000Z",
		});
		expect(
			parseClientUpdateHeader("status=unsupported, reason=compatibility"),
		).toEqual({ status: "unsupported", reason: "compatibility" });
	});

	it("ignores missing or malformed values", () => {
		for (const value of [
			null,
			"",
			"status=unknown",
			'status="current"',
			"latest=1",
			"status=deprecated",
			"status=unsupported",
		])
			expect(parseClientUpdateHeader(value)).toBeUndefined();
	});
});

describe("update state file", () => {
	it("writes the state with mode 0600 and reads it back for the same version", async () => {
		const path = await tempPath();
		await writeUpdateState(
			path,
			state({ status: "outdated", latest: "0.3.0" }),
		);
		expect((await stat(path)).mode & 0o777).toBe(0o600);
		expect(await readUpdateState(path, "0.2.0")).toEqual(
			state({ status: "outdated", latest: "0.3.0" }),
		);
	});

	it("treats another version or an unreadable file as no state", async () => {
		const path = await tempPath();
		await writeUpdateState(
			path,
			state({ status: "unsupported", reason: "security" }),
		);
		expect(await readUpdateState(path, "0.3.0")).toBeUndefined();
		await writeFile(path, "not json");
		expect(await readUpdateState(path, "0.2.0")).toBeUndefined();
		expect(await readUpdateState(`${path}.missing`, "0.2.0")).toBeUndefined();
	});
});

describe("recordingFetch", () => {
	it("sends the User-Agent and saves the state from the response header", async () => {
		const path = await tempPath();
		const base = vi.fn(
			async () =>
				new Response(null, {
					status: 200,
					headers: {
						"harnessforce-client-update": 'status=outdated, latest="0.3.0"',
					},
				}),
		);
		const fetch = recordingFetch(base, CLI, path, () => NOW);

		await fetch(new URL("https://ingest.test/v1/sessions"), {
			method: "POST",
			headers: { authorization: "Bearer key" },
		});

		const init = (base.mock.calls as unknown as [URL, RequestInit][])[0]?.[1];
		const headers = new Headers(init?.headers);
		expect(headers.get("user-agent")).toBe("harnessforce-cli/0.2.0");
		expect(headers.get("authorization")).toBe("Bearer key");
		expect(await readUpdateState(path, "0.2.0")).toEqual(
			state({ status: "outdated", latest: "0.3.0" }),
		);
	});

	it("keeps when outdated was last shown and leaves the file without a header", async () => {
		const path = await tempPath();
		const shownAt = "2026-11-01T00:00:00.000Z";
		await writeUpdateState(path, state({ outdatedShownAt: shownAt }));
		const respond = (header?: string) =>
			recordingFetch(
				async () =>
					new Response(null, {
						headers: header ? { "harnessforce-client-update": header } : {},
					}),
				CLI,
				path,
				() => NOW,
			)(new URL("https://ingest.test/v1/sessions"), {});

		await respond('status=outdated, latest="0.3.0"');
		expect((await readUpdateState(path, "0.2.0"))?.outdatedShownAt).toBe(
			shownAt,
		);
		const before = await readFile(path, "utf8");
		await respond();
		expect(await readFile(path, "utf8")).toBe(before);
	});
});

describe("updateLine", () => {
	it("words each state with the update command of the component", () => {
		expect(
			updateLine(
				"claude-code-plugin",
				state({ status: "unsupported", reason: "security" }),
			),
		).toBe(
			"This Harnessforce plugin version is no longer supported, so nothing is being sent to Harnessforce. Update it: `claude plugin update harnessforce@harnessforce-agent`",
		);
		expect(
			updateLine(
				"cli",
				state({
					status: "deprecated",
					reason: "security",
					deadline: "2026-11-08T00:00:00.000Z",
				}),
			),
		).toBe(
			"A security update for Harnessforce CLI is available. This version stops sending on 2026-11-08 (00:00 UTC). Update it: `npm install -g @harnessforce/cli@latest`",
		);
		expect(
			updateLine(
				"cli",
				state({
					status: "deprecated",
					reason: "compatibility",
					deadline: "2027-12-01T00:00:00.000Z",
				}),
			),
		).toBe(
			"This Harnessforce CLI version stops sending on 2027-12-01 (00:00 UTC). Update it: `npm install -g @harnessforce/cli@latest`",
		);
		expect(
			updateLine("cli", state({ status: "outdated", latest: "0.3.0" })),
		).toBe(
			"Harnessforce CLI 0.3.0 is available. Update it: `npm install -g @harnessforce/cli@latest`",
		);
		expect(updateLine("cli", state())).toBeUndefined();
	});
});

describe("shouldShowOutdated", () => {
	it("shows at most once a day unless NO_UPDATE_NOTIFIER or CI is set", () => {
		const outdated = state({ status: "outdated", latest: "0.3.0" });
		expect(shouldShowOutdated(outdated, NOW, {})).toBe(true);
		expect(
			shouldShowOutdated(
				{ ...outdated, outdatedShownAt: "2026-11-01T00:00:00.001Z" },
				NOW,
				{},
			),
		).toBe(false);
		expect(
			shouldShowOutdated(
				{ ...outdated, outdatedShownAt: "2026-10-31T12:00:00.000Z" },
				NOW,
				{},
			),
		).toBe(true);
		expect(shouldShowOutdated(outdated, NOW, { NO_UPDATE_NOTIFIER: "1" })).toBe(
			false,
		);
		expect(shouldShowOutdated(outdated, NOW, { CI: "true" })).toBe(false);
		expect(shouldShowOutdated(outdated, NOW, { CI: "" })).toBe(true);
		expect(shouldShowOutdated(state(), NOW, {})).toBe(false);
	});
});

describe("recheckClientStatus", () => {
	const unsupported = (receivedAt: string) =>
		state({ status: "unsupported", reason: "security", receivedAt });

	it("asks GET /v1/client-status without credentials when the state is 24 hours old", async () => {
		const path = await tempPath();
		await writeUpdateState(path, unsupported("2026-10-31T12:00:00.000Z"));
		const base = vi.fn(
			async () =>
				new Response(null, {
					status: 204,
					headers: { "harnessforce-client-update": "status=current" },
				}),
		);
		const fetch = recordingFetch(base, CLI, path, () => NOW);

		const after = await recheckClientStatus({
			state: await readUpdateState(path, "0.2.0"),
			ingestBase: new URL("https://ingest.test/base"),
			fetch,
			statePath: path,
			version: "0.2.0",
			now: () => NOW,
		});

		expect(after?.status).toBe("current");
		const [url, init] = base.mock.calls[0] as unknown as [URL, RequestInit];
		expect(String(url)).toBe("https://ingest.test/base/v1/client-status");
		expect(init.method).toBe("GET");
		expect(new Headers(init.headers).has("authorization")).toBe(false);
	});

	it("does not ask while the state is newer than 24 hours or not unsupported", async () => {
		const base = vi.fn();
		for (const current of [unsupported("2026-11-01T00:00:00.000Z"), state()]) {
			const result = await recheckClientStatus({
				state: current,
				ingestBase: new URL("https://ingest.test"),
				fetch: base,
				statePath: await tempPath(),
				version: "0.2.0",
				now: () => NOW,
			});
			expect(result).toEqual(current);
		}
		expect(base).not.toHaveBeenCalled();
	});

	it("stays unsupported when the check fails", async () => {
		const stale = unsupported("2026-10-30T00:00:00.000Z");
		const result = await recheckClientStatus({
			state: stale,
			ingestBase: new URL("https://ingest.test"),
			fetch: async () => {
				throw new Error("offline");
			},
			statePath: await tempPath(),
			version: "0.2.0",
			now: () => NOW,
		});
		expect(result).toEqual(stale);
	});
});
