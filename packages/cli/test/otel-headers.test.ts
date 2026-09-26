import { describe, expect, it } from "vitest";
import { fakeKeychain, runCli } from "./support/cli.js";

const header = (key: string) =>
	`${JSON.stringify({ Authorization: `Bearer ${key}` })}\n`;

describe("hf otel-headers", () => {
	it("prints the user ingest key of HARNESSFORCE_WORKSPACE_ID from the keychain", async () => {
		const { keychain } = fakeKeychain({
			items: {
				"ws1:ingest-key": "hf_ik_ws1_user",
				"ws2:ingest-key": "hf_ik_ws2_user",
			},
		});
		expect(
			await runCli(["otel-headers"], {
				env: { HARNESSFORCE_WORKSPACE_ID: "ws1" },
				keychain,
			}),
		).toEqual({ code: 0, out: header("hf_ik_ws1_user"), err: "" });
	});

	it("prints HARNESSFORCE_INGEST_KEY without reading the keychain", async () =>
		// runCliの既定のkeychainは、触れると例外になる。
		expect(
			await runCli(["otel-headers"], {
				env: {
					HARNESSFORCE_INGEST_KEY: "hf_ik_ws9_managed",
					HARNESSFORCE_WORKSPACE_ID: "ws1",
				},
			}),
		).toEqual({ code: 0, out: header("hf_ik_ws9_managed"), err: "" }));

	it.each([
		["HARNESSFORCE_WORKSPACE_ID is missing", {}, fakeKeychain().keychain],
		[
			"the keychain is unavailable",
			{ HARNESSFORCE_WORKSPACE_ID: "ws1" },
			fakeKeychain({
				available: false,
				items: { "ws1:ingest-key": "hf_ik_ws1_user" },
			}).keychain,
		],
		[
			"the workspace has no key",
			{ HARNESSFORCE_WORKSPACE_ID: "ws1" },
			fakeKeychain({ items: { "ws2:ingest-key": "hf_ik_ws2_user" } }).keychain,
		],
		[
			"the keychain cannot be read",
			{ HARNESSFORCE_WORKSPACE_ID: "ws1" },
			fakeKeychain({ failRead: true }).keychain,
		],
	])("prints nothing and fails when %s", async (_, env, keychain) =>
		expect(await runCli(["otel-headers"], { env, keychain })).toEqual({
			code: 1,
			out: "",
			err: "",
		}));
});
