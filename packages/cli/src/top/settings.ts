import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isObject } from "@harnessforce/agent-core/object";

// terminal-view.md「端末の設定」: `~/.harnessforce/config.json`の`top`。このfileは利用者が書き、CLIは書き換えない。
export type TopSettings = {
	// 曖昧な幅の文字を2桁として数える。
	ambiguousWide: boolean;
	// 点字を使う折れ線を使う。
	braille: boolean;
};

const DEFAULT_SETTINGS: TopSettings = {
	ambiguousWide: false,
	braille: false,
};

const SETTINGS_NOTICE =
	"端末の設定（~/.harnessforce/config.json）を読めないため、既定の表示にします";

export type SettingsRead = { settings: TopSettings; notice?: string };

const unreadable: SettingsRead = {
	settings: DEFAULT_SETTINGS,
	notice: SETTINGS_NOTICE,
};

// 表示の設定を読み損ねても画面を止めない。読めない、object以外、値が範囲外のときは、topのすべての項目を既定にする。
export async function readTopSettings(homeDir: string): Promise<SettingsRead> {
	let text: string;
	try {
		text = await readFile(
			join(homeDir, ".harnessforce", "config.json"),
			"utf8",
		);
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT"
			? { settings: DEFAULT_SETTINGS }
			: unreadable;
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return unreadable;
	}
	if (!isObject(value)) return unreadable;
	if (!("top" in value)) return { settings: DEFAULT_SETTINGS };
	const { top } = value;
	if (!isObject(top)) return unreadable;
	const width = top.ambiguous_width;
	const braille = top.braille;
	if (width !== undefined && width !== 1 && width !== 2) return unreadable;
	if (braille !== undefined && typeof braille !== "boolean") return unreadable;
	return {
		settings: { ambiguousWide: width === 2, braille: braille === true },
	};
}
