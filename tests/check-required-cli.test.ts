import { describe, expect, it } from "vitest";
import {
	checkRequiredCli,
	collectInvocations,
	isNewerVersion,
	pluginInvocations,
} from "../scripts/check-required-cli.mjs";

describe("collectInvocations", () => {
	it("reads the commands and options from inline code and code blocks", () =>
		expect(
			collectInvocations({
				markdown: [
					"Run `harnessforce status --json`, then `harnessforce login --no-plugin-auto-update`.",
					"```sh\nharnessforce top --once --json\nnpm install -g @harnessforce/cli\n```",
					"Run `harnessforce login` again.",
				],
				hookSources: [],
				scriptSources: [],
			}),
		).toEqual([
			{ command: ["login"], options: ["--no-plugin-auto-update"] },
			{ command: ["status"], options: ["--json"] },
			{ command: ["top"], options: ["--json", "--once"] },
		]));

	it("keeps a subcommand and stops at placeholders, heredocs and --", () =>
		expect(
			collectInvocations({
				markdown: [
					"```text\nharnessforce insights record <<'END'\n{}\nEND\n```",
					"`harnessforce run --issue <issue> -- <agent>`",
				],
				hookSources: [],
				scriptSources: [],
			}),
		).toEqual([
			{ command: ["insights", "record"], options: [] },
			{ command: ["run"], options: ["--issue"] },
		]));

	it("ignores the session id line, placeholders and the retired usage-limits", () =>
		expect(
			collectInvocations({
				markdown: [
					"`harnessforce agent_session_id: <agent_session_id>`",
					"`harnessforce <command> --help`",
					"the retired `harnessforce usage-limits` command",
					"`harnessforce: session usage failed (<reason>)`",
				],
				hookSources: [],
				scriptSources: [],
			}),
		).toEqual([]));

	it("reads the arguments the hook passes to harnessforce", () =>
		expect(
			collectInvocations({
				markdown: [],
				hookSources: [
					'await run(cwd, ["otel-headers"]);\nawait run(\n\tdirectory,\n\t["--version"],\n);',
				],
				scriptSources: [],
			}),
		).toEqual([
			{ command: [], options: ["--version"] },
			{ command: ["otel-headers"], options: [] },
		]));
	it("reads the options after an option value and stops at shell operators", () =>
		expect(
			collectInvocations({
				markdown: [
					"`harnessforce top --theme dark --json | jq .`",
					"`harnessforce status --json > status.json --all`",
				],
				hookSources: [],
				scriptSources: [],
			}),
		).toEqual([
			{ command: ["status"], options: ["--json"] },
			{ command: ["top"], options: ["--json", "--theme"] },
		]));

	it("reads the options a skill script passes and forwards to harnessforce", () =>
		expect(
			collectInvocations({
				markdown: [],
				hookSources: [],
				scriptSources: [
					'const ALLOWED_FLAGS = new Set(["--all", "--no-send"]);\nawait harnessforceCommand(["insights", "--json", ...new Set(args)]);',
				],
			}),
		).toEqual([
			{ command: ["insights"], options: ["--all", "--json", "--no-send"] },
		]));
});

describe("the plugin's CLI invocations", () => {
	// pluginの文書とhookが起動するcommandを増やしたら、この一覧とREQUIRED_CLI_VERSIONを見直す。
	it("are the ones the required CLI version is checked against", () =>
		expect(pluginInvocations()).toEqual([
			{ command: [], options: ["--help", "--version"] },
			{ command: ["config", "set", "send-content", "off"], options: [] },
			{ command: ["config", "set", "send-content", "on"], options: [] },
			{ command: ["hook"], options: [] },
			{ command: ["import"], options: [] },
			{ command: ["insights"], options: ["--all", "--json", "--no-send"] },
			{ command: ["insights", "record"], options: [] },
			{ command: ["login"], options: [] },
			{ command: ["logout"], options: [] },
			{ command: ["otel-headers"], options: [] },
			{ command: ["run"], options: ["--issue"] },
			{ command: ["status"], options: ["--json"] },
			{ command: ["top"], options: ["--json", "--once"] },
		]));
});

describe("checkRequiredCli", () => {
	const invocations = [
		{ command: [], options: ["--version"] },
		{ command: ["status"], options: ["--json"] },
		{ command: ["insights", "record"], options: [] },
	];
	const help: Record<string, string> = {
		"--help":
			"Usage: harnessforce <command> [options]\n  --version  Show the version.",
		"status --help": "Usage: harnessforce status [--json]",
		"insights record --help":
			"Usage: harnessforce insights [--json]\n       harnessforce insights record",
	};
	const cli =
		(overrides: Record<string, { code: number; stdout: string }> = {}) =>
		async (args: string[]) => {
			const key = args.join(" ");
			if (key in overrides)
				return overrides[key] as { code: number; stdout: string };
			if (key === "--version") return { code: 0, stdout: "0.4.0\n" };
			return key in help
				? { code: 0, stdout: help[key] as string }
				: { code: 1, stdout: "" };
		};

	it("passes when the CLI of the required version has every command and option", async () =>
		expect(await checkRequiredCli("0.4.0", invocations, cli())).toEqual([]));

	// 必要な版がnpmに未公開の間は、同じcommitのbuildの出力を確かめ、版は比べない。
	it("does not compare the version when no required version is given", async () =>
		expect(
			await checkRequiredCli(
				undefined,
				invocations,
				cli({ "--version": { code: 0, stdout: "0.6.1\n" } }),
			),
		).toEqual([]));

	it("fails when the installed CLI is not the required version", async () =>
		expect(
			await checkRequiredCli(
				"0.4.0",
				invocations,
				cli({ "--version": { code: 0, stdout: "0.4.1\n" } }),
			),
		).toEqual(["harnessforce --version printed 0.4.1, not 0.4.0"]));

	it("fails when a command does not exist in that version", async () =>
		expect(
			await checkRequiredCli(
				"0.4.0",
				[...invocations, { command: ["doctor"], options: [] }],
				cli(),
			),
		).toEqual(["harnessforce doctor --help exited with 1"]));

	it("fails when an option the plugin uses is not in the help of that version", async () =>
		expect(
			await checkRequiredCli(
				"0.4.0",
				[{ command: ["status"], options: ["--json", "--watch"] }],
				cli(),
			),
		).toEqual(["harnessforce status --help does not mention --watch"]));

	it("does not take a longer option for the one the plugin uses", async () =>
		expect(
			await checkRequiredCli(
				"0.4.0",
				[{ command: ["status"], options: ["--js"] }],
				cli(),
			),
		).toEqual(["harnessforce status --help does not mention --js"]));

	it("fails when the help does not show the subcommand", async () =>
		expect(
			await checkRequiredCli(
				"0.4.0",
				[{ command: ["status"], options: [] }],
				cli({
					"status --help": {
						code: 0,
						stdout: "Usage: harnessforce <command> [options]",
					},
				}),
			),
		).toEqual([
			"harnessforce status --help does not mention harnessforce status",
		]));
});

describe("isNewerVersion", () => {
	it.each([
		["0.7.0", "0.6.1", true],
		["0.10.0", "0.9.9", true],
		["0.6.1", "0.6.1", false],
		["0.6.2", "0.7.0", false],
	])("%s is newer than %s: %s", (a, b, expected) =>
		expect(isNewerVersion(a, b)).toBe(expected),
	);
});
