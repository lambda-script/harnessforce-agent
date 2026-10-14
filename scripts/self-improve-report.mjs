import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

// better: 良い方向。前回値より逆へ動いた指標だけを改善候補として挙げる。
export const METRICS = [
	{ id: "correlation_rate", better: "higher" },
	{ id: "actions_per_run", better: "higher" },
	{ id: "permission_prompts_per_run", better: "lower" },
	{ id: "ci_first_pass", better: "higher" },
];

export function isoWeek(date) {
	// ISO 8601: 週は木曜日の属する年で数える。
	const day = new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
	);
	day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
	const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
	const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
	return `${day.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const measured = (value) => typeof value === "number" && !Number.isNaN(value);

const movedWrongWay = ({ id, better }, current, previous) => {
	if (!measured(current[id]) || !measured(previous[id])) return false;
	return better === "higher"
		? current[id] < previous[id]
		: current[id] > previous[id];
};

export function buildReport(current, week, previous = {}) {
	const marker = `<!-- self-improve-report:${week} -->`;
	const rows = METRICS.map(({ id }) => {
		const value = measured(current[id]) ? current[id] : "not measured";
		const before = measured(previous[id]) ? previous[id] : "not measured";
		return `| ${id} | ${value} | ${before} |`;
	});
	const wrong = METRICS.filter((metric) =>
		movedWrongWay(metric, current, previous),
	).map(({ id }) => id);
	const body = [
		marker,
		`Weekly self-improvement report for ${week}.`,
		"",
		"| metric | this week | previous |",
		"| --- | --- | --- |",
		...rows,
		"",
		wrong.length > 0
			? `Moved the wrong way: ${wrong.join(", ")}. Open a PR against the assets that drive these metrics.`
			: "No measured metric moved the wrong way.",
	].join("\n");
	return { marker, title: `Self-improvement report ${week}`, body };
}

const ghOnce = async (args) => (await run("gh", args)).stdout;

/** markerを持つissueがあれば更新し、無ければ作る。週に2回走らせても1件に保つ。 */
export async function upsertIssue({ marker, title, body }, gh = ghOnce) {
	const found = JSON.parse(
		await gh([
			"issue",
			"list",
			"--search",
			`"${marker}" in:body`,
			"--state",
			"open",
			"--json",
			"number,body",
		]),
	).find((issue) => issue.body.includes(marker));
	if (found) {
		await gh(["issue", "edit", String(found.number), "--body", body]);
		return;
	}
	await gh(["issue", "create", "--title", title, "--body", body]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [current, previous] = await Promise.all(
		[process.env.METRICS_FILE, process.env.PREVIOUS_METRICS_FILE].map(
			async (path) => (path ? JSON.parse(await readFile(path, "utf8")) : {}),
		),
	);
	const report = buildReport(current, isoWeek(new Date()), previous);
	if (process.env.DRY_RUN) console.log(report.body);
	else await upsertIssue(report);
}
