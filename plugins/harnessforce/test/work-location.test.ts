import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RunGit } from "@harnessforce/agent-core/process/git";
import { SessionWorkLocationSchema } from "@harnessforce/semconv";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import { compileSchema } from "@harnessforce/test-support/validator";
import { describe, expect, it } from "vitest";
import { runHook } from "../src/hook.js";
import { type Harness, harness, scratchpad } from "./support.js";

const isWorkLocation = compileSchema(SessionWorkLocationSchema);

/** repositoryのrootのcheckout（`main`）と、`eng-42-login`のworktree。branchは呼び出しのたびに読む。 */
function checkouts() {
	const root = tempDir("hf-root-");
	const worktree = join(root, ".worktrees", "eng-42-login");
	mkdirSync(join(worktree, "src"), { recursive: true });
	const branches = new Map([
		[root, "main"],
		[worktree, "eng-42-login"],
	]);
	const treeOf = (cwd: string) =>
		cwd.startsWith(worktree) ? worktree : cwd.startsWith(root) ? root : "";
	const git: RunGit = async (cwd, args) => {
		const tree = treeOf(cwd);
		if (!tree) return undefined;
		const answers: Record<string, string | undefined> = {
			"rev-parse --is-inside-work-tree": "true",
			remote: "origin",
			"remote get-url origin": "git@github.com:Acme/Web.git",
			"symbolic-ref --quiet --short HEAD": branches.get(tree),
			"rev-parse --verify --quiet HEAD": "a".repeat(40),
		};
		return answers[args.join(" ")];
	};
	return { root, worktree, branches, git };
}

function session() {
	const repo = checkouts();
	const pad = scratchpad();
	const h = harness({ git: repo.git });
	const run = (event: string, input: Record<string, unknown> = {}) =>
		runHook(
			event,
			JSON.stringify({
				session_id: "s-1",
				cwd: repo.root,
				scratchpad_dir: pad,
				...input,
			}),
			h.deps,
		);
	return { ...repo, h, run };
}

const sent = (h: Harness) => h.bodiesTo("/v1/sessions/locations");
const pair = (branch: string) => ({
	repository: "github.com/acme/web",
	branch,
});

describe("session work locations from Claude Code", () => {
	it("sends the branch of the worktree whose file was edited at the end of the turn", async () => {
		const s = session();
		await s.run("work-location", {
			tool_name: "Edit",
			tool_input: {
				file_path: join(s.worktree, "src/a.ts"),
				old_string: "secret body",
				new_string: "other body",
			},
		});
		expect(sent(s.h)).toEqual([]);

		await s.run("stop");

		const bodies = sent(s.h);
		expect(bodies).toEqual([
			[
				{
					agent: "claude_code",
					session_id: "s-1",
					locations: [pair("eng-42-login"), pair("main")],
				},
			],
		]);
		expect(bodies.flat().every(isWorkLocation)).toBe(true);
		expect(JSON.stringify(bodies)).not.toContain("body");
		expect(JSON.stringify(bodies)).not.toContain(s.root);
		expect(s.h.out()).toBe("");
	});

	it("does not send again in a turn whose pairs did not change", async () => {
		const s = session();
		await s.run("stop");
		await s.run("stop");
		expect(sent(s.h)).toHaveLength(1);
	});

	it("sends the new branch after the working directory moves to another checkout", async () => {
		const s = session();
		await s.run("stop");
		await s.run("cwd-changed", { old_cwd: s.root, new_cwd: s.worktree });
		await s.run("stop", { cwd: s.worktree });
		expect(sent(s.h).map((body) => body[0])).toEqual([
			expect.objectContaining({ locations: [pair("main")] }),
			expect.objectContaining({
				locations: [pair("main"), pair("eng-42-login")],
			}),
		]);
		expect(s.h.err()).toBe("");
	});

	it("keeps the branch observed at the time even when another session switches that checkout later", async () => {
		const s = session();
		await s.run("work-location", {
			tool_name: "Write",
			tool_input: { file_path: join(s.worktree, "src/b.ts"), content: "x" },
		});
		s.branches.set(s.worktree, "someone-else");
		await s.run("stop");
		expect(JSON.stringify(sent(s.h))).not.toContain("someone-else");
	});

	it("writes nothing to stderr when the working directory changes, even if recording fails", async () => {
		const repo = checkouts();
		const h = harness({ git: repo.git });
		await runHook(
			"cwd-changed",
			JSON.stringify({
				session_id: "s-1",
				cwd: repo.root,
				scratchpad_dir: "/nonexistent/hf-scratch",
				new_cwd: repo.worktree,
			}),
			h.deps,
		);
		expect(h.err()).toBe("");
		expect(h.out()).toBe("");
	});

	it("records and sends nothing without a scratchpad", async () => {
		const repo = checkouts();
		const h = harness({ git: repo.git });
		await runHook(
			"stop",
			JSON.stringify({ session_id: "s-1", cwd: repo.root }),
			h.deps,
		);
		expect(sent(h)).toEqual([]);
	});

	it("stops sending for the session after a 401", async () => {
		const repo = checkouts();
		const pad = scratchpad();
		const h = harness({ git: repo.git, status: 401 });
		const stop = (cwd: string) =>
			runHook(
				"stop",
				JSON.stringify({ session_id: "s-1", cwd, scratchpad_dir: pad }),
				h.deps,
			);
		await stop(repo.root);
		await stop(repo.worktree);
		expect(sent(h)).toHaveLength(1);
		expect(h.err()).toContain(
			"harnessforce: session location failed (unauthorized)",
		);
	});

	it("sends again at the next turn after a failure", async () => {
		const repo = checkouts();
		const pad = scratchpad();
		let status = 503;
		const h = harness({ git: repo.git, statusFor: () => status });
		const stop = () =>
			runHook(
				"stop",
				JSON.stringify({
					session_id: "s-1",
					cwd: repo.root,
					scratchpad_dir: pad,
				}),
				h.deps,
			);
		await stop();
		status = 200;
		await stop();
		await stop();
		expect(sent(h)).toHaveLength(2);
	});
});
