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
				source: "./plugins/harnessforce",
			}),
		]);
		expect(plugin.name).toBe("harnessforce");
	});

	it("points the marketplace source at an existing plugin directory", () =>
		expect(
			existsSync(
				new URL(
					"../plugins/harnessforce/.claude-plugin/plugin.json",
					import.meta.url,
				),
			),
		).toBe(true));

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
		expect(body).toMatch(/複数あれば[^\n]*最後/));

	it("calls start_run again when the latest session id changes", () =>
		expect(body).toMatch(
			/異なる[^\n]*`start_run`をもう1度呼び[^\n]*`complete_run`/,
		));

	it("does not guess a session id missing from the context", () =>
		expect(body).toMatch(/推測[^\n]*`start_run`と`complete_run`を呼ばない/));

	it("records a plan only when neither a current nor a proposed plan exists", () =>
		expect(body).toMatch(/現行のPlanも`proposed`のPlanも無/));

	it("reports each Definition of Done item as met or unmet", () => {
		expect(body).toContain("`met`");
		expect(body).toContain("`unmet`");
	});

	it("tells the agent that its records stay proposed until a person approves them", () =>
		expect(body).toMatch(/`proposed`[^\n]*承認/));

	// correlation.md「agentによるIssueの作成」
	describe("creating an issue for unassigned work", () => {
		it("treats an issue identifier in the branch name as given once get_issue resolves it", () =>
			expect(body).toMatch(/branch名[^\n]*`get_issue`で[^\n]*解決/));

		it("asks once per session id and not again after a refusal", () => {
			expect(body).toMatch(/同じ値で尋ねるのは1回だけ/);
			expect(body).toMatch(/断ったら[^\n]*再び尋ねない/);
		});

		it("asks only for work that commits changes", () =>
			expect(body).toMatch(
				/調べもの、質問への回答、計画だけの会話では尋ねない/,
			));

		it("treats an unresolved branch identifier as no identifier", () =>
			expect(body).toMatch(/`not_found`なら識別子が無い場合と同じに扱う/));

		it("shows existing candidates from list_issues before proposing a new issue", () => {
			const steps = body.slice(body.indexOf("既存のIssueを先に示す"));
			expect(steps).toMatch(/`-status:done,canceled \{語\}`/);
			expect(steps.indexOf("`list_issues`")).toBeLessThan(
				steps.indexOf("`create_issue`"),
			);
		});

		it("keeps the prompt body, paths, commands and secrets out of the title and description", () =>
			expect(body).toMatch(
				/titleと説明には、promptの本文、file path、command、secretを写さない/,
			));

		it("calls create_issue only after the user explicitly agrees", () => {
			expect(body).toMatch(/承諾した場合だけ[^\n]*`create_issue`/);
			expect(body).toMatch(/非対話[^\n]*作らない/);
		});

		it("does not create an issue without an active project", () =>
			expect(body).toMatch(/0件ならIssueを作らず/));

		it("tells teams that the issue is created only in Harnessforce", () =>
			expect(body).toContain("Harnessforceにだけ作られ"));

		it("never retries create_issue and recovers by an exact title match", () => {
			expect(body).toContain("`create_issue`を再試行しない");
			expect(body).toMatch(/titleが完全に一致し、作成時刻が呼び出しの後/);
			expect(body).toMatch(/`start_run`だけが失敗したら[^\n]*作り直さない/);
		});

		it("stops asking when the token cannot create issues", () =>
			expect(body).toMatch(/`forbidden`[^\n]*再び尋ねない/));

		it("leaves planning objects to the user", () =>
			expect(body).toMatch(
				/`create_project`、`create_milestone`、`create_cycle`、`create_objective`を[^\n]*呼ばない/,
			));
	});

	// correlation.md「agentによる状態の更新」
	describe("updating the status of a native issue", () => {
		it("tells native issues apart by a null external", () =>
			expect(body).toContain("`external`が`null`"));

		it("asks before moving a native issue to started or done", () => {
			expect(body).toMatch(
				/承諾した場合だけ[^\n]*`update_issue`で状態を`started`/,
			);
			expect(body).toMatch(/承諾した場合だけ状態を`done`/);
		});

		it("does not ask to complete an issue whose pull request is only opened", () =>
			expect(body).toMatch(/mergeされていない場合は尋ねない/));

		it("never changes the status of an issue from an external provider", () =>
			expect(body).toContain("外部由来のIssueの状態は変えない"));

		it("asks again only once after a conflict", () =>
			expect(body).toMatch(/`conflict`[^\n]*1回だけ尋ね直す/));
	});
});

// onboarding.md「チェックリスト」の手順4「自分の端末で設定する」。
describe("setup command", () => {
	const { frontmatter, body } = splitFrontmatter(
		readText("plugins/harnessforce/commands/setup.md"),
	);
	const NODE_REQUIRED =
		"pluginのhookにはNode.js 18以上が必要です。Node.jsを導入してからClaude Codeを再起動し、もう一度`/harnessforce:setup`を実行してください";

	it("describes itself for the command list", () =>
		expect(frontmatter.description).toEqual(expect.any(String)));

	it("checks Node.js 18 first and stops with the onboarding message", () => {
		expect(body).toContain("`node --version`");
		expect(body).toContain("18未満");
		expect(body).toContain(NODE_REQUIRED);
		expect(body.indexOf("`node --version`")).toBeLessThan(
			body.indexOf("npm install -g"),
		);
	});

	// publicの経路: 公開したCLIをnpmから導入する（environments.md「接続先」）。
	it("installs the published CLI from npm in the repository copy", () =>
		expect(body).toContain("npm install -g @harnessforce/cli"));

	it("runs hf init and hf import, then asks for a restart before confirming the first event", () => {
		// `hf init`は手順2にも現れるため、語の位置だけでは手順を特定できない。見出しの順序に、本文が実行する`hf import`の位置を加えて確かめる。
		const positions = indexesOf(body, [
			"Node.jsを確かめる",
			"再起動後の実行かを確かめる",
			"CLIを導入する",
			"本文データを送るかを選ぶ",
			"Harnessforceに接続する",
			"過去のsessionを取り込む",
			"`hf import`",
			"再起動を案内する",
			"最初のイベントを確認する",
		]);
		expect(positions.every((position) => position >= 0)).toBe(true);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
	});

	// onboarding.md「チェックリスト」の手順4「自分の端末で設定する」: hf initの前に、本文データを送る設定の選択肢を、既定では選ばれない状態で示す。
	it("shows the content choice before hf init, unselected by default", () => {
		const choice = "本文データを送って分析に使えます";
		expect(body).toMatch(
			/`hf init`の前に[^\n]*選択肢を[^\n]*既定では選ばれない/,
		);
		expect(body).toContain(choice);
		expect(body).toContain(
			"Content is not sent (by default). You can enable it later.",
		);
		expect(body.indexOf(choice)).toBeLessThan(
			body.indexOf("ブラウザでHarnessforceにログインし"),
		);
	});

	it("shows what opting in stores, the two conditions, and how to stop", () => {
		expect(body).toContain("`[REDACTED:種類]`");
		expect(body).toContain("本文データの保持期間");
		expect(body).toMatch(/読めるのはOwnerとAdminだけ/);
		expect(body).toMatch(/端末のこの設定とWorkspaceのopt-inの2つ/);
		expect(body).toMatch(/opt-inを解除すると[^\n]*本文は受信時に破棄され/);
		expect(body).toContain("`hf init --send-content`");
		expect(body).toMatch(
			/Claude Codeのuser settingsの`env`に書き[^\n]*project[^\n]*local[^\n]*`env`には書かない/,
		);
		expect(body).toMatch(/`OTEL_LOG_USER_PROMPTS`を`0`にする/);
		expect(body).toMatch(/projectとlocalの`env`でも効く/);
	});

	it("relays what hf init prints when the workspace has not opted in", () => {
		expect(body).toMatch(/`hf init --send-content`は本文の設定を書かず/);
		expect(body).toContain("Workspaceの設定のデータの保持");
		expect(body).toMatch(/終了コード0/);
	});
});

// improvement-loop.md「提案の記録」「Fidelity」「適用」: `/harnessforce:tune`の手順。
describe("tune command", () => {
	const { frontmatter, body } = splitFrontmatter(
		readText("plugins/harnessforce/commands/tune.md"),
	);
	const SUMMARIZE = "skills/propose-improvements/scripts/summarize.mjs";
	const DISCLOSURE =
		"この実行では、提案を作るために、この端末のsessionの記録の一部をagentが読みます。読んだ内容は、ふだんこのagentに使っているmodelのproviderへ、通常のsessionと同じ経路で渡ります。Harnessforceへは渡りません。";

	it("is run only by the user and describes itself", () => {
		expect(frontmatter["disable-model-invocation"]).toBe(true);
		expect(frontmatter.description).toEqual(expect.any(String));
	});

	// 「読むもの」: 実行の最初に、記録の内容がmodelのproviderへ渡ることを表示する。
	it("tells that the transcripts go to the model provider before running anything", () => {
		expect(body).toContain(DISCLOSURE);
		expect(body.indexOf(DISCLOSURE)).toBeLessThan(body.indexOf("```sh"));
	});

	it("runs hf tune --json through the shipped summary script with the user's arguments", () => {
		const pluginRoot = ["$", "{CLAUDE_PLUGIN_ROOT}"].join("");
		expect(body).toContain(`node "${pluginRoot}/${SUMMARIZE}" $ARGUMENTS`);
		expect(
			existsSync(
				new URL(`../plugins/harnessforce/${SUMMARIZE}`, import.meta.url),
			),
		).toBe(true);
		expect(frontmatter["argument-hint"]).toBe("[--all] [--no-send]");
	});

	it("shows hf tune's messages as they are and keeps not measured apart from zero", () => {
		expect(body).toMatch(/stderr[^\n]*すべてそのまま表示/);
		expect(body).toMatch(/「未計測」を0と言い換えない/);
	});

	it("makes no proposal on exit codes other than 0 and 3 or when data is insufficient", () => {
		expect(body).toMatch(/終了コードが0と3以外なら、提案を作らず/);
		expect(body).toMatch(
			/データ不足のため提案を作りません[^\n]*提案を作らずに終わる/,
		);
	});

	it("shows what each insufficient target still needs", () =>
		expect(body).toMatch(
			/「データ不足」[^\n]*あと何が必要か[^\n]*提案を作らない/,
		));

	it("hands the eligible targets to the skill, which records before showing", () => {
		expect(body).toContain("`propose-improvements`のskill");
		expect(body).toMatch(/`hf tune record`で記録してから表示/);
		expect(body).toMatch(/終了コード0で終わらなかった提案は表示しない/);
	});

	// 「適用」: `/harnessforce:tune`はファイルを書き換えない（`~/.harnessforce/tune/`を除く）。
	it("writes nothing but hf tune's own files and leaves applying to the user", () => {
		expect(body).toMatch(/managed settingsを書き換えない/);
		expect(body).toContain("`~/.harnessforce/tune/`へ書くものだけ");
		expect(body).toMatch(/適用は利用者が行う/);
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
			"| すべて | 分析した範囲に10 session以上ある |",
			"| 人の介入 | その`intervention.kind`が、3 session以上で合計10回以上ある |",
			"| ループにできる繰り返し | その`loop.kind`が、合計3回以上ある |",
			"| MCP server | `configured`のsessionが10以上ある |",
		])
			expect(body).toContain(row);
		expect(body).toMatch(/未計測（`not_measured`）の値を根拠にしない/);
	});

	it("gives each proposal the evidence, an applicable change, the expected effect and how to measure it", () => {
		const positions = indexesOf(body, [
			"| 対象のカテゴリ |",
			"| 根拠 |",
			"| 変更の種類 |",
			"| 適用先 |",
			"| 変更 | そのまま適用できるunified diff。repositoryのscopeなら、branch名、title、本文、diffからなるPull Requestの下書き。",
			"| 期待する効果 |",
			"| 測り方 |",
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
		expect(body).toMatch(/最小の範囲だけ/);
		expect(body).toContain("すべてのコマンドを許可する規則を提案しない");
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

	it("always gives a loop proposal its stop conditions", () =>
		expect(body).toMatch(
			/止める条件を必ず含める。止める条件は、最大の繰り返し回数と、人が確認する時点/,
		));

	// 「提案の記録」: 表示の前に`hf tune record`で記録し、成功した提案だけを表示する。
	it("records each proposal with hf tune record before showing it", () => {
		expect(body).toMatch(/表示する前に、提案ごとに`hf tune record`を実行/);
		expect(body).toMatch(
			/`hf tune record`が終了コード0で終わった提案だけを表示/,
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
		expect(body).toMatch(/同じ提案は同じ入力で記録する/));

	// 「適用」: ファイルを書き換えない。
	it("never writes the user's files", () => {
		expect(body).toMatch(/managed settingsを書き換えない/);
		for (const writer of ["Edit、Writeのtool", "`git apply`", "`gh pr create`"])
			expect(body).toContain(writer);
		expect(body).toMatch(/fileに書かない/);
	});
});
