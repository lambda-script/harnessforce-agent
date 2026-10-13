import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const read = (p: string) =>
	JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));

describe("plugin skeleton", () => {
	const marketplace = read(".claude-plugin/marketplace.json");
	const plugin = read("plugins/harnessforce/.claude-plugin/plugin.json");

	it("matches the install command in onboarding (harnessforce@harnessforce-agent)", () => {
		expect(marketplace.name).toBe("harnessforce-agent");
		expect(marketplace.plugins).toEqual([
			expect.objectContaining({
				name: "harnessforce",
				source: {
					source: "npm",
					package: "@harnessforce/claude-code-plugin",
				},
			}),
		]);
		expect(plugin.name).toBe("harnessforce");
	});

	// environments.md「接続先」: versionを指定せず、npmのlatestを導入する。
	it("installs the plugin from npm at the latest version", () => {
		const [entry] = marketplace.plugins;
		expect(entry.source).not.toHaveProperty("version");
		expect(entry).not.toHaveProperty("version");
	});

	it("names the npm package the plugin package publishes", () =>
		expect(read("plugins/harnessforce/package.json").name).toBe(
			marketplace.plugins[0].source.package,
		));

	// hookのscriptはbuildの出力（plugins/harnessforce/dist/marketplace）にだけある。repositoryから直接導入しても存在しないscriptを起動しない。
	it("wires no hooks in the repository copy of the plugin", () =>
		expect(read("plugins/harnessforce/hooks/hooks.json")).toEqual({
			hooks: {},
		}));

	// MCP serverのURLはbuildの入力から作るため、buildの出力にだけ宣言する（correlation.md「接続先」）。
	it("declares no MCP server in the repository copy of the plugin", () =>
		expect(
			existsSync(new URL("../plugins/harnessforce/.mcp.json", import.meta.url)),
		).toBe(false));

	it("declares the public license and repository", () => {
		expect(plugin.license).toBe("Apache-2.0");
		expect(plugin.repository).toBe(
			"https://github.com/lambda-script/harnessforce-agent",
		);
	});

	// Claude Codeはmarketplaceの説明を一覧と`/plugin`の画面に出す。`claude plugin validate --strict`も要求する。
	it("describes the marketplace, not only the plugin in it", () =>
		expect(marketplace.description).toEqual(expect.any(String)));
});

const readText = (p: string) =>
	readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

function splitFrontmatter(markdown: string) {
	const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(markdown);
	if (!match) throw new Error("no frontmatter");
	return { frontmatter: parse(match[1] as string), body: match[2] as string };
}

const indexesOf = (text: string, words: string[]) =>
	words.map((word) => text.indexOf(word));

// correlation.md「MCP」: pluginに同梱し、agentへMCPのtoolの手順を示す。Agent Skillsの形式で書く。
describe("run recording skill", () => {
	const { frontmatter, body } = splitFrontmatter(
		readText("plugins/harnessforce/skills/record-run/SKILL.md"),
	);

	it("follows the Agent Skills frontmatter rules", () => {
		expect(frontmatter.name).toBe("record-run");
		expect(frontmatter.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
		expect(typeof frontmatter.description).toBe("string");
		expect(frontmatter.description.length).toBeGreaterThan(0);
		expect(frontmatter.description.length).toBeLessThanOrEqual(1024);
	});

	it("walks the agent through the MCP tools in the order of the spec", () => {
		const positions = indexesOf(body, [
			"`start_run`",
			"`get_issue`",
			"`record_plan`",
			"`record_decision`",
			"`complete_run`",
		]);
		expect(positions.every((position) => position >= 0)).toBe(true);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
	});

	it("passes the session_id from the context to start_run", () =>
		expect(body).toMatch(/`session_id`[^\n]*`start_run`/));

	// correlation.md「session context」: SessionStartのhookがadditionalContextへ書く文言と同じ形を読む。
	it("reads the session id from the line the SessionStart hook adds", () =>
		expect(body).toContain("`harnessforce session_id: <session_id>`"));

	it("uses the last session id in the context", () =>
		expect(body).toMatch(/several[^\n]*last/));

	it("calls start_run again when the latest session id changes", () =>
		expect(body).toMatch(
			/differs[^\n]*call `start_run` once more[^\n]*`complete_run`/,
		));

	it("does not guess a session id missing from the context", () =>
		expect(body).toMatch(
			/do not guess[^\n]*do not call `start_run` or `complete_run`/,
		));

	it("records a plan only when neither a current nor a proposed plan exists", () =>
		expect(body).toMatch(/neither a current Plan nor a `proposed` Plan/));

	it("reports each Definition of Done item as met or unmet", () => {
		expect(body).toContain("`met`");
		expect(body).toContain("`unmet`");
	});

	it("tells the agent that its records stay proposed until a person approves them", () =>
		expect(body).toMatch(/`proposed`[^\n]*until a person approves/));

	// correlation.md「agentによるIssueの作成」
	describe("creating an issue for unassigned work", () => {
		it("treats an issue identifier in the branch name as given once get_issue resolves it", () =>
			expect(body).toMatch(/branch name[^\n]*`get_issue` can resolve/));

		it("asks once per session id and not again after a refusal", () => {
			expect(body).toMatch(/Ask only once for the same value/);
			expect(body).toMatch(/declines, do not ask again/);
		});

		it("asks only for work that commits changes", () =>
			expect(body).toMatch(
				/Do not ask for research, answers to questions, or conversations that only plan/,
			));

		it("treats an unresolved branch identifier as no identifier", () =>
			expect(body).toMatch(
				/If it is `not_found`, treat it the same as when there is no identifier/,
			));

		it("shows existing candidates from list_issues before proposing a new issue", () => {
			const steps = body.slice(body.indexOf("Show existing Issues first"));
			expect(steps).toMatch(/`-status:done,canceled \{word\}`/);
			expect(steps.indexOf("`list_issues`")).toBeLessThan(
				steps.indexOf("`create_issue`"),
			);
		});

		it("keeps the prompt body, paths, commands and secrets out of the title and description", () =>
			expect(body).toMatch(
				/Do not copy the prompt text, file paths, commands, or secrets into the title or the description/,
			));

		it("calls create_issue only after the user explicitly agrees", () => {
			expect(body).toMatch(/Only if the user accepts[^\n]*`create_issue`/);
			expect(body).toMatch(/non-interactive[^\n]*do not create it/);
		});

		it("does not create an issue without an active project", () =>
			expect(body).toMatch(/If there are 0, do not create the Issue/));

		it("tells teams that the issue is created only in Harnessforce", () =>
			expect(body).toContain("Created in Harnessforce only"));

		it("never retries create_issue and recovers by an exact title match", () => {
			expect(body).toContain("Do not retry `create_issue`");
			expect(body).toMatch(
				/title matches exactly and whose creation time is after the call/,
			);
			expect(body).toMatch(
				/only `start_run` fails[^\n]*do not recreate the Issue/,
			);
		});

		it("stops asking when the token cannot create issues", () =>
			expect(body).toMatch(/`forbidden`[^\n]*do not ask again/));

		it("leaves planning objects to the user", () =>
			expect(body).toMatch(
				/Do not call `create_project`, `create_milestone`, `create_cycle`, or `create_objective`/,
			));
	});

	// correlation.md「agentによる状態の更新」
	describe("updating the status of a native issue", () => {
		it("tells native issues apart by a null external", () =>
			expect(body).toContain("`external` in `get_issue` is `null`"));

		it("asks before moving a native issue to started or done", () => {
			expect(body).toMatch(
				/only if the user agrees change the status to `started` with `update_issue`/,
			);
			expect(body).toMatch(
				/only if the user agrees change the status to `done`/,
			);
		});

		it("does not ask to complete an issue whose pull request is only opened", () =>
			expect(body).toMatch(
				/Do not ask when you only opened a Pull Request and it has not been merged/,
			));

		it("never changes the status of an issue from an external provider", () =>
			expect(body).toContain(
				"Do not change the status of an externally sourced Issue",
			));

		it("asks again only once after a conflict", () =>
			expect(body).toMatch(/`conflict`[^\n]*ask once more/));
	});
});

// onboarding.md「チェックリスト」の手順4「自分の端末で設定する」。
describe("setup command", () => {
	const { frontmatter, body } = splitFrontmatter(
		readText("plugins/harnessforce/commands/setup.md"),
	);
	const NODE_REQUIRED =
		"Harnessforce hooks require Node.js 18 or later. Install Node.js, restart Claude Code, then run `/harnessforce:setup` again.";

	it("describes itself for the command list", () =>
		expect(frontmatter.description).toEqual(expect.any(String)));

	it("checks Node.js 18 first and stops with the onboarding message", () => {
		expect(body).toContain("`node --version`");
		expect(body).toContain("below 18");
		expect(body).toContain(NODE_REQUIRED);
		expect(body.indexOf("`node --version`")).toBeLessThan(
			body.indexOf("npm install -g"),
		);
	});

	// publicの経路: 公開したCLIをnpmから導入する（environments.md「接続先」）。
	it("installs the published CLI from npm in the repository copy", () =>
		expect(body).toContain("npm install -g @harnessforce/cli"));

	it("runs harnessforce init and harnessforce import, then asks for a restart before confirming the first event", () => {
		// `harnessforce init`は手順2にも現れるため、語の位置だけでは手順を特定できない。見出しの順序に、本文が実行する`harnessforce import`の位置を加えて確かめる。
		const positions = indexesOf(body, [
			"Check Node.js",
			"Check whether this run is after the restart",
			"Install the CLI",
			"Choose whether to send prompt content",
			"Connect to Harnessforce",
			"Import past sessions",
			"`harnessforce import`",
			"Ask for a restart",
			"Confirm the first event",
		]);
		expect(positions.every((position) => position >= 0)).toBe(true);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
	});

	// onboarding.md「チェックリスト」の手順4「自分の端末で設定する」: harnessforce initの前に、本文データを送る設定の選択肢を、既定では選ばれない状態で示す。
	it("shows the content choice before harnessforce init, unselected by default", () => {
		const choice = "You can send the prompts you type for analysis";
		expect(body).toMatch(
			/Before `harnessforce init`, present the option[^\n]*not selected by default/,
		);
		expect(body).toContain(choice);
		expect(body).toContain(
			"Content is not sent (by default). You can enable it later.",
		);
		expect(body.indexOf(choice)).toBeLessThan(
			body.indexOf("Tell the user to log in to Harnessforce"),
		);
	});

	it("shows what opting in stores, the two conditions, and how to stop", () => {
		expect(body).toContain("`[REDACTED:kind]`");
		expect(body).toContain("content retention period");
		expect(body).toContain("content retention period (at most 30 days)");
		expect(body).toContain("not everything can be detected");
		expect(body).toMatch(
			/only the person who sent the stored content can read it; Owners and Admins cannot read it either/,
		);
		expect(body).toContain("only you can read it");
		expect(body).not.toMatch(/only Owners and Admins/);
		expect(body).not.toMatch(/body of (the )?(model )?responses/i);
		expect(body).toMatch(
			/both this setting on the device and the Workspace opt-in/,
		);
		expect(body).toMatch(
			/opt-in is withdrawn, later content is discarded on receipt/,
		);
		expect(body).toContain("`harnessforce init --send-content`");
		expect(body).toMatch(
			/Write this setting to the `env` of the Claude Code user settings, and do not write it to the `env` of the project[^\n]*local/,
		);
		expect(body).toMatch(
			/set `OTEL_LOG_USER_PROMPTS` in the `env` of the user settings to `0`/,
		);
		expect(body).toMatch(/also takes effect in the project and local `env`/);
	});

	// onboarding.md「チェックリスト」の手順4: 利用枠の同意は利用者自身が文面に答える。agentは`--yes`で代行しない。
	it("shows the usage limits choice only when the workspace opted in, and never answers the consent with --yes", () => {
		expect(body).not.toContain("usage-limits on --yes");
		expect(body).toContain("`harnessforce usage-limits status`");
		expect(body).toMatch(
			/is not "enabled"[^\n]*do not present the usage-limits option/,
		);
		expect(body).toMatch(
			/so that the user answers the consent text themselves/,
		);
	});

	it("relays what harnessforce init prints when the workspace has not opted in", () => {
		expect(body).toMatch(
			/`harnessforce init --send-content` does not write the content setting/,
		);
		expect(body).toContain("Data retention page of the Workspace settings");
		expect(body).toMatch(/exits with code 0/);
	});
});

// improvement-loop.md「提案の記録」「Fidelity」「適用」: `/harnessforce:tune`の手順。
describe("tune command", () => {
	const { frontmatter, body } = splitFrontmatter(
		readText("plugins/harnessforce/commands/tune.md"),
	);
	const SUMMARIZE = "skills/propose-improvements/scripts/summarize.mjs";
	const DISCLOSURE =
		"To make suggestions, the agent reads part of the session records on this device in this run. What it reads goes to the provider of the model you normally use with this agent, through the same path as a normal session. It does not go to Harnessforce.";

	it("is run only by the user and describes itself", () => {
		expect(frontmatter["disable-model-invocation"]).toBe(true);
		expect(frontmatter.description).toEqual(expect.any(String));
	});

	// 「読むもの」: 実行の最初に、記録の内容がmodelのproviderへ渡ることを表示する。
	it("tells that the transcripts go to the model provider before running anything", () => {
		expect(body).toContain(DISCLOSURE);
		expect(body.indexOf(DISCLOSURE)).toBeLessThan(body.indexOf("```sh"));
	});

	it("runs harnessforce tune --json through the shipped summary script with the user's arguments", () => {
		const pluginRoot = ["$", "{CLAUDE_PLUGIN_ROOT}"].join("");
		expect(body).toContain(`node "${pluginRoot}/${SUMMARIZE}" $ARGUMENTS`);
		expect(
			existsSync(
				new URL(`../plugins/harnessforce/${SUMMARIZE}`, import.meta.url),
			),
		).toBe(true);
		expect(frontmatter["argument-hint"]).toBe("[--all] [--no-send]");
	});

	it("shows harnessforce tune's messages as they are and keeps not measured apart from zero", () => {
		expect(body).toMatch(/stderr[^\n]*Show all of them as they are/);
		expect(body).toMatch(/Do not rephrase "not measured" as 0/);
	});

	it("makes no proposal on exit codes other than 0 and 3 or when data is insufficient", () => {
		expect(body).toMatch(
			/If the exit code is anything other than 0 or 3, finish without making suggestions/,
		);
		expect(body).toMatch(
			/"Not enough data, so no suggestions are made" line[^\n]*finish without making suggestions/,
		);
	});

	it("shows what each insufficient target still needs", () =>
		expect(body).toMatch(
			/"Not enough data"[^\n]*what is still needed[^\n]*make no suggestion/,
		));

	it("hands the eligible targets to the skill, which records before showing", () => {
		expect(body).toContain("the `propose-improvements` skill");
		expect(body).toMatch(
			/record them with `harnessforce tune record`, and then show them/,
		);
		expect(body).toMatch(
			/Do not show a suggestion whose recording did not end with exit code 0/,
		);
	});

	// 「前回の提案の前後」: 新しい提案の前に表示し、前後の差が因果を示さないことを添える。
	it("shows the before and after of earlier proposals before new proposals", () => {
		expect(body).toContain('"Before and after the previous suggestion"');
		expect(body).toContain(
			'"Before/after difference (does not show causation)"',
		);
		expect(
			body.indexOf('"Before and after the previous suggestion"'),
		).toBeLessThan(body.indexOf("## 3. Make suggestions"));
	});

	// 「適用」: `/harnessforce:tune`はファイルを書き換えない（`~/.harnessforce/tune/`を除く）。
	it("writes nothing but harnessforce tune's own files and leaves applying to the user", () => {
		expect(body).toMatch(/repository, or managed settings/);
		expect(body).toContain("write to `~/.harnessforce/tune/`");
		expect(body).toMatch(/applying the suggestions is up to the user/);
	});
});

// improvement-loop.md「作る条件」「形式」: 提案を作る公開のskill。
describe("propose improvements skill", () => {
	const { frontmatter, body } = splitFrontmatter(
		readText("plugins/harnessforce/skills/propose-improvements/SKILL.md"),
	);

	it("follows the Agent Skills frontmatter rules", () => {
		expect(frontmatter.name).toBe("propose-improvements");
		expect(frontmatter.description.length).toBeGreaterThan(0);
		expect(frontmatter.description.length).toBeLessThanOrEqual(1024);
	});

	it("keeps the minimum condition of each target", () => {
		for (const row of [
			"| All | The analyzed range has at least 10 sessions |",
			"| Human interventions | That `intervention.kind` appears in at least 3 sessions and at least 10 times in total |",
			"| Repeatable loops | That `loop.kind` appears at least 3 times in total |",
			"| MCP servers | At least 10 sessions have `configured` |",
			"| `frequent_compaction` and `low_cache_reuse` of usage | At least 3 sessions match that `usage.kind` |",
			"| `model_choice` of usage | At least 10 sessions have `models`, and in the total of `models` over the analyzed range, one `message.model` value accounts for at least 90% of the total `output_tokens` |",
		])
			expect(body).toContain(row);
		expect(body).toMatch(
			/Do not use a value that was not measured \(`not_measured`\) as evidence/,
		);
	});

	it("gives each proposal the evidence, an applicable change, the expected effect and how to measure it", () => {
		const positions = indexesOf(body, [
			"| Target category |",
			"| Evidence |",
			"| Change type |",
			"| Apply to |",
			"| Change | A unified diff that can be applied as it is. For the repository scope, a Pull Request draft made of the branch name, the title, the body, and the diff.",
			"| Expected effect |",
			"| How to measure |",
		]);
		expect(positions.every((position) => position >= 0)).toBe(true);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
	});

	it("maps every change type of the fixed vocabulary", () => {
		for (const changeType of [
			"permissions",
			"hook",
			"skill",
			"rule",
			"agent",
			"command",
			"loop_prompt",
			"mcp_config",
			"claude_md",
		])
			expect(body).toMatch(new RegExp(`^\\| \`${changeType}\` \\|`, "m"));
	});

	// 「形式」: 許可は最小の範囲に限り、すべてのコマンドの許可を提案しない。
	it("limits permissions to the smallest scope and never allows every command", () => {
		expect(body).toMatch(/smallest range of tools and commands/);
		expect(body).toContain("Do not suggest a rule that allows all commands");
		for (const broad of [
			"`Bash`",
			"`Bash(*)`",
			"`Bash(:*)`",
			"`*`",
			'`"defaultMode": "bypassPermissions"`',
			"`--dangerously-skip-permissions`",
		])
			expect(body).toContain(broad);
	});

	// 「作る条件」: 使い方の提案の変更の種類は5つに限り、claude_mdは前後に現れない。
	it("limits usage proposals to five change types and says claude_md has no follow-up", () => {
		expect(body).toContain(
			"The change type of a usage suggestion is limited to `claude_md`, `rule`, `skill`, `agent`, and `command`",
		);
		expect(body).toMatch(
			/A change to `claude_md` is not detected when applied, so it does not appear in the before and after of the previous suggestion either/,
		);
	});

	// 「前回の提案の前後」: 良くなった向きへ動いていない提案は、同じ対象の新しい提案の根拠に示し、同じ差分を繰り返さない。
	it("uses earlier proposals that did not improve as evidence and does not repeat their diff", () =>
		expect(body).toMatch(
			/Did not move in the improving direction[^\n]*evidence[^\n]*do not repeat the same diff/,
		));

	it("always gives a loop proposal its stop conditions", () =>
		expect(body).toMatch(
			/must include stopping conditions. The stopping conditions are both the maximum number of repetitions and the points where a person checks/,
		));

	// 「提案の記録」: 表示の前に`harnessforce tune record`で記録し、成功した提案だけを表示する。
	it("records each proposal with harnessforce tune record before showing it", () => {
		expect(body).toMatch(
			/Before showing a suggestion, run `harnessforce tune record` for each suggestion/,
		);
		expect(body).toMatch(
			/Show only the suggestions for which `harnessforce tune record` ended with exit code 0/,
		);
		for (const field of [
			"category",
			"change_type",
			"scope",
			"path",
			"project_root",
			"component",
			"content",
			"value",
			"evidence_session_ids",
			"body",
		])
			expect(body).toMatch(new RegExp(`^\\| \`${field}\` \\|`, "m"));
	});

	it("records the same proposal with the same input so it counts once", () =>
		expect(body).toMatch(/Record the same suggestion with the same input/));

	// 「適用」: ファイルを書き換えない。
	it("never writes the user's files", () => {
		expect(body).toMatch(/repository, or managed settings/);
		for (const writer of [
			"the Edit or Write tools",
			"`git apply`",
			"`gh pr create`",
		])
			expect(body).toContain(writer);
		expect(body).toMatch(/do not write it to a file/);
	});
});
