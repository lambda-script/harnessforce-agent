import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { describe, expect, it } from "vitest";
import {
	ingestKeyAccount,
	ingestOriginAccount,
} from "../../src/credentials/keychain.js";
import { fakeKeychain, runCli } from "../support/cli.js";

// correlation.md「Codexのhook」「sessionの作業位置」。
const WORKSPACE = "019f0000-0000-7000-8000-000000000001";
const ENDPOINT = "https://ingest.example.test/base";
const KEY = "hf_ik_secretkeyvalue";

function codexSession(status = 202) {
	const root = tempDir("hf-codex-root-");
	const worktree = join(root, ".worktrees", "eng-42-login");
	mkdirSync(join(worktree, "src"), { recursive: true });
	const tmp = tempDir("hf-codex-tmp-");
	const treeOf = (cwd: string) =>
		cwd.startsWith(worktree) ? worktree : cwd.startsWith(root) ? root : "";
	const branches = new Map([
		[root, "main"],
		[worktree, "eng-42-login"],
	]);
	const git = async (cwd: string, args: readonly string[]) => {
		const tree = treeOf(cwd);
		if (!tree) return undefined;
		const key = args.join(" ");
		if (key === "rev-parse --is-inside-work-tree") return "true";
		if (key === "remote") return "origin";
		if (key === "remote get-url origin") return "git@github.com:Acme/Web.git";
		if (key === "symbolic-ref --quiet --short HEAD") return branches.get(tree);
		if (key === "rev-parse --verify --quiet HEAD") return "a".repeat(40);
		return undefined;
	};
	const sent: unknown[] = [];
	const { keychain } = fakeKeychain({
		items: {
			[ingestKeyAccount(WORKSPACE)]: KEY,
			[ingestOriginAccount(WORKSPACE)]: "https://ingest.example.test",
		},
	});
	const run = (event: string, input: Record<string, unknown>) =>
		runCli(["hook", event], {
			homeDir: tempDir("hf-codex-home-"),
			env: {
				HARNESSFORCE_WORKSPACE_ID: WORKSPACE,
				HARNESSFORCE_ENDPOINT: ENDPOINT,
			},
			keychain,
			hookGit: git as never,
			hookTmpDir: tmp,
			readStdin: async () =>
				Buffer.from(
					JSON.stringify({ session_id: "sess-1", cwd: root, ...input }),
				),
			fetch: async (url, init) => {
				sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
				return new Response(null, { status });
			},
		});
	return { root, worktree, run, sent };
}

describe("harnessforce hook post-tool-use and stop", () => {
	it("sends the branch of the worktree a patch edited at the end of the turn", async () => {
		const s = codexSession();
		const patch = [
			"*** Begin Patch",
			`*** Update File: ${join(s.worktree, "src/a.ts")}`,
			"@@",
			"-secret body",
			"+other body",
			"*** End Patch",
		].join("\n");
		const edited = await s.run("post-tool-use", {
			hook_event_name: "PostToolUse",
			tool_name: "apply_patch",
			tool_input: { command: patch },
		});
		expect(edited).toEqual({ code: 0, out: "", err: "" });
		expect(s.sent).toEqual([]);

		const stopped = await s.run("stop", { hook_event_name: "Stop" });

		expect(stopped.code).toBe(0);
		expect(stopped.out).toBe("{}\n");
		expect(s.sent).toEqual([
			{
				url: `${ENDPOINT}/v1/sessions/locations`,
				body: [
					{
						agent: "codex",
						session_id: "sess-1",
						locations: [
							{ repository: "github.com/acme/web", branch: "eng-42-login" },
							{ repository: "github.com/acme/web", branch: "main" },
						],
					},
				],
			},
		]);
		expect(JSON.stringify(s.sent)).not.toContain("secret body");
		expect(JSON.stringify(s.sent)).not.toContain(s.root);
	});

	it("does not send again while the pairs stay the same", async () => {
		const s = codexSession();
		await s.run("stop", {});
		await s.run("stop", {});
		expect(s.sent).toHaveLength(1);
	});

	it("stops sending for the session after a 401", async () => {
		const s = codexSession(401);
		const first = await s.run("stop", {});
		await s.run("stop", { cwd: s.worktree });
		expect(s.sent).toHaveLength(1);
		expect(first.err).toContain(
			"harnessforce: session location failed (unauthorized)",
		);
	});

	it("prints the empty object at Stop even for an input it cannot read", async () => {
		const s = codexSession();
		const result = await runCli(["hook", "stop"], {
			readStdin: async () => Buffer.from("not json"),
		});
		expect(result).toEqual({ code: 0, out: "{}\n", err: "" });
		expect(s.sent).toEqual([]);
	});
});
