import type { UsageLimitSummary } from "@harnessforce/agent-core/ingest";
import { isObject } from "@harnessforce/agent-core/object";
import type { SendState } from "./files.js";

// usage-limits.md「取るもの」。statusLineのJSONの窓の名前と、共通の形の`window_minutes`。
const WINDOWS = [
	{ name: "five_hour", minutes: 300 },
	{ name: "seven_day", minutes: 10080 },
] as const;
// usage-limits.md「Claude Code」: 直前の送信からこの間は、resetが変わらない限り送らない。
const MIN_SEND_INTERVAL_MS = 5 * 60 * 1000;

type Window = UsageLimitSummary["windows"][number];

// 秒未満を持たない瞬間。例: 2026-10-10T08:00:00Z
const instant = (ms: number) =>
	new Date(ms).toISOString().replace(".000Z", "Z");

// usage-limits.md「取るもの」: 窓が欠けている、resetが観測の時刻以前、消費率が0から100の数でない窓は送らない。
function windowFrom(
	value: unknown,
	minutes: number,
	nowMs: number,
): Window | undefined {
	if (!isObject(value)) return undefined;
	const { used_percentage: used, resets_at: resetsAt } = value;
	if (typeof used !== "number" || !(used >= 0 && used <= 100)) return undefined;
	// resetが観測の時刻以前の窓は、既に終わった窓。
	if (typeof resetsAt !== "number" || !Number.isFinite(resetsAt))
		return undefined;
	const resetsAtMs = Math.floor(resetsAt) * 1000;
	if (resetsAtMs <= nowMs) return undefined;
	return {
		window_minutes: minutes,
		used_percent: used,
		resets_at: instant(resetsAtMs),
	};
}

// statusLineのJSONから取り出すのは`rate_limits`の2つの窓の消費率とresetだけで、他の項目は読まない。
// JSONとして読めない、または送れる窓が無ければundefined。
export function summaryFrom(
	stdin: string,
	nowMs: number,
): UsageLimitSummary | undefined {
	let json: unknown;
	try {
		json = JSON.parse(stdin);
	} catch {
		return undefined;
	}
	const limits = isObject(json) ? json.rate_limits : undefined;
	if (!isObject(limits)) return undefined;
	const windows = WINDOWS.flatMap(({ name, minutes }) => {
		const window = windowFrom(limits[name], minutes, nowMs);
		return window ? [window] : [];
	});
	return windows.length === 0
		? undefined
		: {
				agent: "claude_code",
				observed_at: instant(Math.floor(nowMs / 1000) * 1000),
				windows,
			};
}

const resetSeconds = (window: Window) => Date.parse(window.resets_at) / 1000;

// 新しい窓が始まった（resetが直前と違う）ときは、間隔を待たずに送る。
export function isDue(
	summary: UsageLimitSummary,
	state: SendState | undefined,
	nowMs: number,
): boolean {
	if (!state) return true;
	const changed = summary.windows.some(
		(window) =>
			state.resets_at[String(window.window_minutes)] !== resetSeconds(window),
	);
	return changed || nowMs - state.sent_at >= MIN_SEND_INTERVAL_MS;
}

export const stateFor = (
	summary: UsageLimitSummary,
	nowMs: number,
): SendState => ({
	sent_at: nowMs,
	resets_at: Object.fromEntries(
		summary.windows.map((window) => [
			String(window.window_minutes),
			resetSeconds(window),
		]),
	),
});

// 自分が組み立てた要素を子processが受け取るときの検査。形が違えばundefined。
export function parseSummary(raw: string): UsageLimitSummary | undefined {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!isObject(value) || value.agent !== "claude_code") return undefined;
	const { observed_at: observedAt, windows } = value;
	if (typeof observedAt !== "string" || !Array.isArray(windows))
		return undefined;
	const rebuilt = windows.flatMap((window) => {
		if (!isObject(window)) return [];
		const { window_minutes: minutes, used_percent: used } = window;
		const resetsAt = window.resets_at;
		const known = WINDOWS.some((w) => w.minutes === minutes);
		const valid =
			known &&
			typeof minutes === "number" &&
			typeof used === "number" &&
			used >= 0 &&
			used <= 100 &&
			typeof resetsAt === "string" &&
			!Number.isNaN(Date.parse(resetsAt));
		return valid
			? [{ window_minutes: minutes, used_percent: used, resets_at: resetsAt }]
			: [];
	});
	// 1つでも形の違う窓があれば、全体を送らない。
	return rebuilt.length > 0 && rebuilt.length === windows.length
		? { agent: "claude_code", observed_at: observedAt, windows: rebuilt }
		: undefined;
}
