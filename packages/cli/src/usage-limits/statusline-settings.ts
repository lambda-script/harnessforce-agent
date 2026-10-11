import { isObject } from "@harnessforce/agent-core/object";
import type { UsageLimitsMark } from "./files.js";

const STATUSLINE_COMMAND = "harnessforce usage-limits statusline";

type Settings = Record<string, unknown>;

const isEmbedded = (statusLine: unknown) =>
	isObject(statusLine) && statusLine.command === STATUSLINE_COMMAND;

// usage-limits.md「statusLineの組み込み」手順2。組み込めるのは、statusLineが無いか、`type: "command"`で`command`が文字列のobject。
export function canEmbed(settings: Settings): boolean {
	const { statusLine } = settings;
	if (statusLine === undefined) return true;
	return (
		isObject(statusLine) &&
		statusLine.type === "command" &&
		typeof statusLine.command === "string"
	);
}

// 手順5: 元のstatusLine。組み込み済みで印があれば印の値を変えず、印が無ければnull。
export function originalFor(
	settings: Settings,
	mark: UsageLimitsMark | undefined,
): UsageLimitsMark["original"] {
	const { statusLine } = settings;
	if (isEmbedded(statusLine)) return mark ? mark.original : null;
	return isObject(statusLine) ? statusLine : null;
}

// 手順6。`command`だけを置き換え、`type`、`padding`、`refreshInterval`など他の項目は変えない。
export function embedStatusLine(settings: Settings): Settings {
	const { statusLine } = settings;
	if (isEmbedded(statusLine)) return settings;
	return {
		...settings,
		statusLine: isObject(statusLine)
			? { ...statusLine, command: STATUSLINE_COMMAND }
			: { type: "command", command: STATUSLINE_COMMAND },
	};
}

// `off`: 組み込みのものなら、元の値へ書き戻す（元が無ければ削除する）。組み込みのものでなければ変えない。
export function restoreStatusLine(
	settings: Settings,
	original: UsageLimitsMark["original"],
): Settings {
	if (!isEmbedded(settings.statusLine)) return settings;
	const { statusLine: _embedded, ...rest } = settings;
	return original === null ? rest : { ...settings, statusLine: original };
}

export const isStatusLineEmbedded = (settings: Settings) =>
	isEmbedded(settings.statusLine);
